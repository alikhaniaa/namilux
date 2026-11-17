import { AppError, appError, audit, faInt, isAppError, tagsForBannerChange, toImageRef, upsertBanner } from "@namilux/core";
import type { Actor, Banner, BannerInput, MediaRowLike } from "@namilux/core";
import { and, asc, banners as bannersTable, eq, inArray, media as mediaTable, notInArray, sql } from "@namilux/db";
import type { Db, Row } from "@namilux/db";

/**
 * The /ig landing page is edited as ONE list: what the owner sees in the editor is what the slot
 * holds after "save". The public reader (getBanners) hides inactive and scheduled cards, so the
 * editor reads the raw slot rows here instead - a card switched off must still be there to switch
 * back on, and a card missing from the editor must not survive the save.
 */
const SLOT = "ig_landing" as const;

export type IgCardAdmin = Banner & { mediaLightId: string | null; mediaDarkId: string | null };
export type IgCardInput = Omit<BannerInput, "slot" | "sort"> & { slot?: string; sort?: number };

type BannerRow = Row<typeof bannersTable>;
type MediaRow = Row<typeof mediaTable>;

/** Namespaced so no other advisory lock in the app can collide with it by accident. */
export const IG_LOCK_KEY = "namilux:banners:ig_landing:replace";
const REFRESH_HINT ="صفحه را تازه کنید و دوباره ذخیره کنید.";

// DECISION: local, like the copies in core/content/banners.ts and core/catalog/* - the module that
// owns MediaRowLike exports no row mapper.
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

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

function toCard(row: BannerRow, media: Map<string, MediaRow>): IgCardAdmin {
  const title = row.title?.trim() ?? "";
  const image = (id: string | null) => {
    if (id === null) return null;
    const m = media.get(id);
    return m === undefined ? null : toImageRef(mediaRowLike(m), { altFallback: title });
  };
  return {
    id: row.id,
    slot: row.slot,
    title,
    subtitle: row.subtitle,
    ctaLabel: row.ctaLabel,
    ctaHref: row.ctaHref,
    mediaLight: image(row.mediaLightId),
    mediaDark: image(row.mediaDarkId),
    mediaLightId: row.mediaLightId,
    mediaDarkId: row.mediaDarkId,
    theme: row.theme,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    isActive: row.isActive,
    sort: row.sort,
    targeting: row.targetingJson ?? null,
  };
}

/** Every ig_landing card - active or not, scheduled or not - in the order the page shows them. */
export async function listIgCards(db: Db): Promise<IgCardAdmin[]> {
  const rows = await db
    .select()
    .from(bannersTable)
    .where(eq(bannersTable.slot, SLOT))
    .orderBy(asc(bannersTable.sort), asc(bannersTable.id));
  const mediaIds = new Set<string>();
  for (const r of rows) {
    if (r.mediaLightId !== null) mediaIds.add(r.mediaLightId);
    if (r.mediaDarkId !== null) mediaIds.add(r.mediaDarkId);
  }
  const byId = new Map<string, MediaRow>();
  if (mediaIds.size > 0) {
    for (const m of await db.select().from(mediaTable).where(inArray(mediaTable.id, [...mediaIds]))) byId.set(m.id, m);
  }
  return rows.map((r) => toCard(r, byId));
}

const cardError = (index: number, fa: string, details: Record<string, unknown>): AppError =>
  appError("VALIDATION", { fa: `کارت شمارهٔ ${faInt(index + 1)}: ${fa}`, details: { card: index, ...details } });

/**
 * Replace the whole ig_landing slot with `cards`, in order, as ONE transaction: cards with an id are
 * updated, cards without one are created, and saved cards the list no longer carries are deleted.
 * Every id is checked against the slot before the first write, so a stale or hand-edited list can
 * neither duplicate a card nor pull a banner out of another slot; any failure rolls the whole save
 * back. Returns the ids in list order so the editor can adopt them for the next save.
 */
export async function replaceIgCards(
  db: Db,
  cards: readonly IgCardInput[],
  actor: Actor,
): Promise<{ ids: number[]; removed: number[]; revalidate: string[] }> {
  const seen = new Map<number, number>();
  for (const [i, card] of cards.entries()) {
    if (card.slot !== undefined && card.slot !== SLOT) {
      throw cardError(i, "این کارت به صفحهٔ اینستاگرام تعلق ندارد. " + REFRESH_HINT, { field: "slot", reason: "wrong_slot" });
    }
    if (card.id === undefined) continue;
    const first = seen.get(card.id);
    if (first !== undefined) {
      throw cardError(i, `همان کارت شمارهٔ ${faInt(first + 1)} است و دو بار در فهرست آمده. ${REFRESH_HINT}`, {
        field: "id",
        reason: "duplicate_id",
        id: card.id,
      });
    }
    seen.set(card.id, i);
  }

  return db.transaction(async (tx) => {
    // Two editors saving at once must apply one after the other. Row locks alone cannot do that for
    // an empty slot (nothing to lock, so both first saves would insert), hence a transaction-scoped
    // advisory lock on a fixed key for the slot, taken before the slot is read; FOR UPDATE on top
    // still guards the rows against writers that do not take the advisory lock (the banners page).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${IG_LOCK_KEY}))`);
    const current = await tx
      .select({ id: bannersTable.id, title: bannersTable.title, isActive: bannersTable.isActive })
      .from(bannersTable)
      .where(eq(bannersTable.slot, SLOT))
      .for("update");
    const inSlot = new Set(current.map((r) => r.id));

    const outside = [...seen.keys()].filter((id) => !inSlot.has(id));
    if (outside.length > 0) {
      const found = await tx
        .select({ id: bannersTable.id })
        .from(bannersTable)
        .where(inArray(bannersTable.id, outside));
      const exists = new Set(found.map((r) => r.id));
      const id = outside[0] as number;
      const index = seen.get(id) as number;
      throw exists.has(id)
        ? cardError(index, `این کارت مال بخش دیگری از بنرهاست و این‌جا ذخیره نمی‌شود. ${REFRESH_HINT}`, {
            field: "id",
            reason: "foreign_slot",
            id,
          })
        : cardError(index, `این کارت دیگر وجود ندارد؛ احتمالاً کس دیگری آن را حذف کرده. ${REFRESH_HINT}`, {
            field: "id",
            reason: "unknown_id",
            id,
          });
    }

    const tags = new Set<string>();
    const ids: number[] = [];
    for (const [i, card] of cards.entries()) {
      try {
        const r = await upsertBanner(tx, { ...card, slot: SLOT, sort: i }, actor);
        ids.push(r.id);
        for (const t of r.tags) tags.add(t);
      } catch (e) {
        // Name the card the refusal belongs to: a bare "عنوان لازم است" on a grid of twelve cards
        // does not tell the owner where to look.
        if (isAppError(e) && e.code === "VALIDATION") {
          const d = e.details;
          const details = typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : { detail: d };
          throw new AppError(e.code, e.httpStatus, `کارت شمارهٔ ${faInt(i + 1)}: ${e.fa}`, { card: i, ...details });
        }
        throw e;
      }
    }

    const kept = new Set(ids);
    const gone = current.filter((r) => !kept.has(r.id));
    if (gone.length > 0) {
      const goneIds = gone.map((r) => r.id);
      await tx
        .delete(bannersTable)
        .where(and(eq(bannersTable.slot, SLOT), inArray(bannersTable.id, goneIds), ids.length > 0 ? notInArray(bannersTable.id, ids) : undefined));
      for (const r of gone) {
        await audit.log(tx, actor, "banner.delete", "banner", String(r.id), { slot: SLOT, title: r.title, isActive: r.isActive }, null);
      }
      for (const t of tagsForBannerChange(SLOT)) tags.add(t);
    }

    return { ids, removed: gone.map((r) => r.id), revalidate: [...tags] };
  });
}
