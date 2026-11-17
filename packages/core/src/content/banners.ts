import {
  and,
  asc,
  banners as bannersTable,
  brands as brandsTable,
  collections as collectionsTable,
  eq,
  inArray,
  media as mediaTable,
} from "@namilux/db";
import type { Db, Row } from "@namilux/db";
import type { Actor } from "../types";
import type { BannerSlot } from "../constants";

// DECISION (M0 step 3): BANNER_SLOTS / BannerTheme are declared once in ../constants and Banner /
// BannerInput once in ../types. `isLive` stays here: it is exported once for the whole package
// (see ../catalog/collections.ts) because a banner is the entity whose whole model is the
// [startsAt, endsAt) window and both headers spell the predicate identically.
import { BANNER_SLOTS } from "../constants";
import type { BannerTheme } from "../constants";
import type { Banner, BannerInput } from "../types";
import { appError } from "../errors";
import { faZwnj, stripControl } from "../persian";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { tags as cacheTags } from "../cache/tags";
import { tagsForBannerChange } from "../cache/invalidation";
import type { ImageRef, MediaRowLike } from "../catalog/media";
import { toImageRef } from "../catalog/media";
import { isSafeHref } from "./menus";

export { BANNER_SLOTS };
export type { BannerTheme, Banner, BannerInput };

export type BannerTargeting = { collectionSlug?: string; brandSlug?: string };

export const SLOT_MEDIA_REQUIRED: Readonly<Record<BannerSlot, boolean>> = {
  promo_bar: false,
  home_hero: true,
  home_band: true,
  category_tile: true,
  plp_inline: true,
  pdp_band: true,
  ig_landing: true,
};

const TITLE_MAX = 120;
const PROMO_TITLE_MAX = 70;
const SUBTITLE_MAX = 200;
const CTA_LABEL_MAX = 40;

/** the spec - no exclamation marks in UI copy (ASCII and full-width). */
const EXCLAMATION_RE = /[!！]/;
/** rules: promo-bar copy is Persian-digits-only. */
const LATIN_DIGIT_RE = /[0-9]/;

const isBannerSlot = (slot: unknown): slot is BannerSlot =>
  typeof slot === "string" && (BANNER_SLOTS as readonly string[]).includes(slot);

const invalid = (field: string, reason: string, extra?: Record<string, unknown>): never => {
  throw appError("VALIDATION", { details: { field, reason, ...extra } });
};

// ---------------------------------------------------------------- the window (pure)

/**
 * DECISION: an unparseable boundary makes the banner NOT live. `starts_at`/`ends_at` are timestamps
 * in Postgres, so this can only happen when a caller hands in a hand-built object; refusing to show
 * a campaign whose window cannot be read is the safe direction (a missed banner, never a permanent
 * one - F-073 forbids exactly that).
 */
function instant(value: string | null | undefined): number | null | "invalid" {
  if (value === null || value === undefined) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? "invalid" : ms;
}

export function isLive(
  b: { isActive: boolean; startsAt: string | null; endsAt: string | null },
  at: Date,
): boolean {
  if (!b.isActive) return false;
  const now = at.getTime();
  if (!Number.isFinite(now)) return false;
  const from = instant(b.startsAt);
  const to = instant(b.endsAt);
  if (from === "invalid" || to === "invalid") return false;
  // half-open [startsAt, endsAt): startsAt exactly `at` is live, endsAt exactly `at` is not.
  if (from !== null && now < from) return false;
  if (to !== null && now >= to) return false;
  return true;
}

export function nextBoundary(
  banners: { startsAt: string | null; endsAt: string | null }[],
  at: Date,
): Date | null {
  const now = at.getTime();
  let best: number | null = null;
  for (const b of banners) {
    for (const raw of [b.startsAt, b.endsAt]) {
      const ms = instant(raw);
      if (ms === null || ms === "invalid") continue;
      // strictly future: a boundary that already passed cannot flip a cache entry any more
      if (ms <= now) continue;
      if (best === null || ms < best) best = ms;
    }
  }
  return best === null ? null : new Date(best);
}

export function pickForTarget(banners: Banner[], target: BannerTargeting): Banner[] {
  return banners.filter((b) => {
    const t = b.targeting;
    if (t === null || t === undefined) return true;
    // rules: "a set key must equal the target's" - an unset key matches anything, so an empty
    // targeting object behaves exactly like null.
    if (t.brandSlug !== undefined && t.brandSlug !== target.brandSlug) return false;
    if (t.collectionSlug !== undefined && t.collectionSlug !== target.collectionSlug) return false;
    return true;
  });
}

// ---------------------------------------------------------------- read side

type BannerRow = Row<typeof bannersTable>;
type MediaRow = Row<typeof mediaTable>;

/**
 * DECISION: local here (and in ../catalog/brands.ts, ../catalog/collections.ts) because the module
 * whose contract owns `MediaRowLike` exports no row mapper.
 */
function mediaRowLike(row: MediaRow): MediaRowLike {
  const r = row.renditionsJson;
  const n = row.normalizeJson;
  return {
    id: row.id,
    kind: row.kind,
    storageKey: row.storageKey,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    alt: row.alt,
    lqip: row.lqip,
    renditionsJson: r == null ? null : { master: r.master, avif: r.avif ?? {}, webp: r.webp ?? {} },
    normalizeJson:
      n == null
        ? null
        : {
            ...(n.subjectH === undefined ? {} : { subjectH: n.subjectH }),
            ...(n.widthBound === undefined ? {} : { widthBound: n.widthBound }),
            ...(n.quarantined === undefined ? {} : { quarantined: n.quarantined }),
            ...(n.reason == null ? {} : { reason: n.reason }),
          },
  };
}

const imageOf = (row: MediaRow | undefined, altFallback: string): ImageRef | null =>
  row === undefined ? null : toImageRef(mediaRowLike(row), { altFallback });

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

function toBanner(row: BannerRow, media: Map<string, MediaRow>): Banner {
  const title = row.title?.trim() ?? "";
  const ctaHref = row.ctaHref?.trim() ?? "";
  const ctaLabel = row.ctaLabel?.trim() ?? "";
  // DECISION: href hygiene is re-checked at READ time as well (defence in depth, the spec): a value
  // that reached the column through a path other than upsertBanner never becomes a rendered link.
  // The CTA is dropped as a pair - a label without a target is a dead button.
  const cta = ctaHref !== "" && ctaLabel !== "" && isSafeHref(ctaHref);
  return {
    id: row.id,
    slot: row.slot,
    title,
    subtitle: row.subtitle?.trim() ?? null,
    ctaLabel: cta ? ctaLabel : null,
    ctaHref: cta ? ctaHref : null,
    mediaLight: row.mediaLightId === null ? null : imageOf(media.get(row.mediaLightId), title),
    mediaDark: row.mediaDarkId === null ? null : imageOf(media.get(row.mediaDarkId), title),
    theme: row.theme,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    isActive: row.isActive,
    sort: row.sort,
    targeting: row.targetingJson ?? null,
  };
}

export async function getBanners(db: Db, slot: BannerSlot, at?: Date): Promise<Banner[]> {
  if (!isBannerSlot(slot)) return [];
  const now = at ?? new Date();

  // `is_active` is filtered in SQL (it is in the slot index); the window is applied in JS so the
  // half-open semantics of `isLive` are the ONE definition the whole package shares.
  const rows = await db
    .select()
    .from(bannersTable)
    .where(and(eq(bannersTable.slot, slot), eq(bannersTable.isActive, true)))
    .orderBy(asc(bannersTable.sort), asc(bannersTable.id));

  const live = rows.filter((row) =>
    isLive({ isActive: row.isActive, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt) }, now),
  );
  return hydrate(db, live);
}

/**
 * Every row of a slot - switched off, scheduled, expired and live alike - in the storefront's
 * order. The ADMIN read: `getBanners(slot, new Date(0))` is not a substitute, because it still
 * drops inactive rows in SQL and every row whose window has started after 1970 (i.e. all of them),
 * so an editor fed by it silently loses the rows it is supposed to manage.
 */
export async function getAllBanners(db: Db, slot: BannerSlot): Promise<Banner[]> {
  if (!isBannerSlot(slot)) return [];
  const rows = await db
    .select()
    .from(bannersTable)
    .where(eq(bannersTable.slot, slot))
    .orderBy(asc(bannersTable.sort), asc(bannersTable.id));
  return hydrate(db, rows);
}

async function hydrate(db: Db, rows: BannerRow[]): Promise<Banner[]> {
  if (rows.length === 0) return [];

  // one extra statement for both media variants of every banner - never one per row
  const mediaIds = new Set<string>();
  for (const row of rows) {
    if (row.mediaLightId !== null) mediaIds.add(row.mediaLightId);
    if (row.mediaDarkId !== null) mediaIds.add(row.mediaDarkId);
  }
  const byId = new Map<string, MediaRow>();
  if (mediaIds.size > 0) {
    const found = await db.select().from(mediaTable).where(inArray(mediaTable.id, [...mediaIds]));
    for (const m of found) byId.set(m.id, m);
  }

  return rows.map((row) => toBanner(row, byId));
}

// ---------------------------------------------------------------- write side

/**
 * rules: "tagsForBannerChange(slot, targeting) → home (home_* / promo_bar), content, brand/collection
 * tags, catalog for plp_inline/category_tile".
 * DECISION: built from ../cache/tags rather than ../cache/invalidation.tagsForBannerChange (named in
 * dependency list) because that function was not yet built when this was written, throws, and takes no `targeting` - the same
 * call the catalogue modules made (../catalog/brands.ts upsertBrand).
 */
function bannerTags(slot: BannerSlot, targeting: { brandId?: number; collectionId?: number }): string[] {
  const out: string[] = [cacheTags.content];
  if (slot === "promo_bar" || slot === "home_hero" || slot === "home_band") out.push(cacheTags.home);
  if (slot === "plp_inline" || slot === "category_tile") out.push(cacheTags.catalog);
  if (targeting.brandId !== undefined) out.push(cacheTags.brand(targeting.brandId));
  if (targeting.collectionId !== undefined) out.push(cacheTags.collection(targeting.collectionId));
  return out;
}

function copyField(raw: string | null | undefined, max: number, field: string): string | null {
  if (raw === null || raw === undefined) return null;
  const value = faZwnj(stripControl(raw).trim());
  if (value === "") return null;
  if (value.length > max) return invalid(field, "too_long", { max });
  if (EXCLAMATION_RE.test(value)) return invalid(field, "exclamation");
  return value;
}

/** Resolve the targeting slugs to ids so the cache tags can name the entity (rules). */
async function resolveTargeting(
  db: Db,
  targeting: BannerTargeting | null,
): Promise<{ brandId?: number; collectionId?: number }> {
  const out: { brandId?: number; collectionId?: number } = {};
  if (targeting === null) return out;

  if (targeting.brandSlug !== undefined) {
    const slug = targeting.brandSlug.trim().toLowerCase();
    const row = (
      await db.select({ id: brandsTable.id }).from(brandsTable).where(eq(brandsTable.slug, slug)).limit(1)
    )[0];
    // DECISION: an unknown targeting slug is a VALIDATION, not a silently ignored key - a banner
    // targeted at a brand that does not exist would never render and the owner would never know.
    if (row === undefined) invalid("targeting.brandSlug", "unknown_brand", { slug });
    else out.brandId = row.id;
  }

  if (targeting.collectionSlug !== undefined) {
    const slug = targeting.collectionSlug.trim().toLowerCase();
    const row = (
      await db
        .select({ id: collectionsTable.id })
        .from(collectionsTable)
        .where(eq(collectionsTable.slug, slug))
        .limit(1)
    )[0];
    if (row === undefined) invalid("targeting.collectionSlug", "unknown_collection", { slug });
    else out.collectionId = row.id;
  }

  return out;
}

async function assertImageMedia(db: Db, ids: readonly string[]): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const found = await db
    .select({ id: mediaTable.id })
    .from(mediaTable)
    .where(and(inArray(mediaTable.id, wanted), eq(mediaTable.kind, "image")));
  const known = new Set(found.map((row) => row.id));
  for (const id of wanted) {
    // DECISION: checked here rather than relying on the media_id foreign key - an FK violation is a
    // 500 with a Postgres message, and a video/file id would pass the FK and render nothing.
    if (!known.has(id)) invalid("mediaLightId", "unknown_media", { id });
  }
}

export async function upsertBanner(
  db: Db,
  input: BannerInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  if (!isBannerSlot(input.slot)) return invalid("slot", "invalid");
  const slot = input.slot;

  const titleMax = slot === "promo_bar" ? PROMO_TITLE_MAX : TITLE_MAX;
  const title = copyField(input.title, titleMax, "title");
  if (title === null) return invalid("title", "required");
  // rules: the promo line is Persian copy - Latin digits belong to a model designator,
  // never to a rotating message. Other slots may carry a Latin model name in the title.
  if (slot === "promo_bar" && LATIN_DIGIT_RE.test(title)) return invalid("title", "latin_digit");

  const subtitle = copyField(input.subtitle, SUBTITLE_MAX, "subtitle");
  const ctaLabel = copyField(input.ctaLabel, CTA_LABEL_MAX, "ctaLabel");
  const rawHref = input.ctaHref?.trim() ?? "";
  const ctaHref = rawHref === "" ? null : rawHref;
  if (ctaHref !== null && !isSafeHref(ctaHref)) return invalid("ctaHref", "unsafe_href");
  // rules: "ctaLabel required when ctaHref is set". DECISION: the reverse is a VALIDATION too
  // (validation/marketing.bannerSchema already refuses it) - a label with no target is a dead button.
  if ((ctaHref === null) !== (ctaLabel === null)) return invalid("ctaLabel", "cta_pair_required");

  const startsAt = input.startsAt == null ? null : new Date(input.startsAt);
  const endsAt = input.endsAt == null ? null : new Date(input.endsAt);
  if (startsAt !== null && Number.isNaN(startsAt.getTime())) return invalid("startsAt", "invalid");
  if (endsAt !== null && Number.isNaN(endsAt.getTime())) return invalid("endsAt", "invalid");
  if (startsAt !== null && endsAt !== null && startsAt.getTime() >= endsAt.getTime()) {
    return invalid("endsAt", "invalid_window");
  }
  // rules / EDGE CASE: a promo-bar message is time-bound by definition (F-073) - never a slogan.
  if (slot === "promo_bar" && endsAt === null) return invalid("endsAt", "required");

  const mediaLightId = input.mediaLightId ?? null;
  const mediaDarkId = input.mediaDarkId ?? null;
  if (SLOT_MEDIA_REQUIRED[slot] && mediaLightId === null) return invalid("mediaLightId", "required");
  // EDGE CASE: promo_bar carries no media (validation/marketing.bannerSchema refuses it as well).
  if (slot === "promo_bar" && (mediaLightId !== null || mediaDarkId !== null)) {
    return invalid("mediaLightId", "not_allowed", { slot });
  }
  await assertImageMedia(db, [mediaLightId, mediaDarkId].filter((id): id is string => id !== null));

  // DECISION: the stored targeting is rebuilt key by key (never spread) so an explicitly-undefined
  // key cannot land in jsonb as `null`, and both slugs are folded to lowercase - `pickForTarget`
  // compares them verbatim against the page's brand/collection slug, which is lowercase by the spec
  const rawTargeting = input.targeting ?? null;
  const targeting: BannerTargeting | null =
    rawTargeting === null
      ? null
      : {
          ...(rawTargeting.brandSlug === undefined
            ? {}
            : { brandSlug: rawTargeting.brandSlug.trim().toLowerCase() }),
          ...(rawTargeting.collectionSlug === undefined
            ? {}
            : { collectionSlug: rawTargeting.collectionSlug.trim().toLowerCase() }),
        };
  const targetIds = await resolveTargeting(db, targeting);

  const values = {
    slot,
    title,
    subtitle,
    ctaLabel,
    ctaHref,
    mediaLightId,
    mediaDarkId,
    theme: input.theme,
    startsAt,
    endsAt,
    isActive: input.isActive,
    sort: input.sort,
    targetingJson: targeting,
  };

  const existing =
    input.id === undefined
      ? undefined
      : (await db.select().from(bannersTable).where(eq(bannersTable.id, input.id)).limit(1))[0];
  if (input.id !== undefined && existing === undefined) {
    throw appError("NOT_FOUND", { details: { entity: "banner", id: input.id } });
  }

  let id: number;
  if (existing === undefined) {
    const inserted = await db.insert(bannersTable).values(values).returning({ id: bannersTable.id });
    const row = inserted[0];
    if (row === undefined) throw appError("INTERNAL", { details: { reason: "banner_insert_failed" } });
    id = row.id;
    await audit.log(db, actor, "banner.create", "banner", String(id), undefined, values);
  } else {
    id = existing.id;
    await db.update(bannersTable).set(values).where(eq(bannersTable.id, id));
    await audit.log(db, actor, "banner.update", "banner", String(id), existing, values);
  }

  const tags = bannerTags(slot, targetIds);

  // rules: two `cache.revalidate` jobs so a scheduled campaign appears/disappears on its own.
  // DECISION: only a FUTURE boundary is enqueued - a job with a past `runAt` would fire immediately
  // and revalidate a state that is already correct (the same reading as `nextBoundary`).
  const now = Date.now();
  for (const [boundary, runAt] of [
    ["start", startsAt],
    ["end", endsAt],
  ] as const) {
    if (runAt === null || runAt.getTime() <= now) continue;
    await jobs.enqueue(
      db,
      "cache.revalidate",
      { bannerId: id, boundary, tags },
      { uniqueKey: `banner:${id}:${boundary}`, runAt },
    );
  }

  return { id, tags };
}

/**
 * the spec: an inactive banner may be removed for good (nl_admin holds DELETE on banners); a live
 * one must be switched off first, so a slot never loses a message by accident.
 */
export async function deleteBanner(db: Db, id: number, actor: Actor): Promise<{ tags: string[] }> {
  const rows = await db.select({ id: bannersTable.id, slot: bannersTable.slot, isActive: bannersTable.isActive, title: bannersTable.title }).from(bannersTable).where(eq(bannersTable.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) throw appError("NOT_FOUND", { fa: "بنر پیدا نشد" });
  if (row.isActive) throw appError("CONFLICT", { fa: "بنر فعال را نمی‌توان حذف کرد؛ اول غیرفعالش کنید" });
  await db.delete(bannersTable).where(eq(bannersTable.id, id));
  await audit.log(db, actor, "banner.delete", "banners", String(id), { slot: row.slot, title: row.title }, null);
  return { tags: tagsForBannerChange(row.slot) };
}
