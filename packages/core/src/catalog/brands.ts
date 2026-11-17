import { brands as brandsTable, eq, media as mediaTable, sql } from "@namilux/db";
import type { Db, Row } from "@namilux/db";
import type { Actor } from "../types";
import type { ImageRef } from "./media";
import { toImageRef } from "./media";
import type { MediaRowLike } from "./media";
import { appError, isAppError } from "../errors";
import { faZwnj } from "../persian";
import { sanitizeHtml } from "../html";
import { brandUrl } from "../url";
import { audit } from "../audit";
import { tags as cacheTags } from "../cache/tags";
import { insertRedirect } from "../content/redirects";
import type { SeoFields } from "./categories";

export type BrandSummary = {
  id: number;
  slug: string;
  name: string;
  nameEn: string;
  logo: ImageRef | null;
  productCount: number;
  buyableCount: number;
  isActive: boolean;
  sort: number;
};

// DECISION (M0 step 3): BrandView is declared once in ../types (the spec §catalog).
import type { BrandView } from "../types";

export type { BrandView };

export type BrandInput = {
  id?: number;
  slug: string;
  nameFa: string;
  nameEn: string;
  claim: string;
  storyHtml: string;
  logoMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  isActive: boolean;
  sort: number;
};

export const LEGACY_BRAND_IDS: Readonly<Record<string, number>> = {
  smeg: 24,
  dyson: 52,
  breville: 159,
  sage: 182,
  como: 190,
  figaro: 196,
  bambum: 197,
};

export const NEW_BRAND_SLUGS: readonly string[] = [
  "ninja",
  "tefal",
  "berghoff",
  "moai",
  "bissell",
  "philips",
];

// ---------------------------------------------------------------- constants

/**
 * DECISION: the header types `BrandView` as `BrandSummary & { claim; storyHtml; seo; robots;
 * comingSoon; legacyLastmod; updatedAt; crumbs; jsonld }`, but `../types/product.ts` owns the name
 * (M0 step 3; src/index.ts rules) and declares
 * `{ id, slug, nameFa, nameEn, claim: string | null, storyHtml, logo, isActive, productCount,
 *   buyableCount, seo }` - which this module re-exports above. The canonical shape wins and nothing
 * a page needs is lost: `comingSoon` is exactly `isActive && buyableCount === 0` (rules) and is
 * derived by the caller from two fields it already has, `robots`/`lastmod` live inside `seo`, and
 * the crumb chain of a brand is the fixed [«خانه» "/", «فروشگاه» "/shop/", nameFa `brandUrl(slug)`]
 * triple of the rules, which the page composes from `nameFa` + `slug`. Recorded in
 * the spec.
 */
const SITE_TITLE_SUFFIX = " - نامی لوکس";

/** the spec: `brands.robots` defaults to this; a blank stored value degrades to it, never to "". */
const DEFAULT_ROBOTS = "index, follow";

/** contract: `/^[a-z0-9-]{2,40}$/` - brand slugs are Latin. */
const LATIN_SLUG_RE = /^[a-z0-9-]{2,40}$/;

/**
 * The availability predicate of products.repo.ts rules, verbatim, as one SQL expression over the
 * alias `p`: untracked stock and backorder are available at qty 0, and only reservations that are
 * still alive count against the quantity.
 * DECISION: it is spelled here (and in ./collections) instead of being imported, because
 * products.repo.ts - the file whose rules define it as "one SQL expression, reused by queryCards,
 * listReadyIds, counts and facets.ts" - was not yet built when this was written and exports no such fragment. When it
 * lands, these three copies must be replaced by that single export.
 */
const AVAILABLE_SQL = sql`(p.stock_policy = 'untracked' or p.allow_backorder or (p.stock_qty - coalesce((select sum(r.qty) from inventory_reservations r where r.product_id = p.id and r.released_at is null and r.consumed_at is null), 0)) >= 1)`;

type BrandRow = Row<typeof brandsTable>;
type MediaRow = Row<typeof mediaTable>;
type BrandCounts = { total: number; buyable: number };

// ---------------------------------------------------------------- pure helpers

export function isLatinSlug(slug: string): boolean {
  return LATIN_SLUG_RE.test(slug);
}

/** rules: "/brand/<Slug>/ with capitals is matched case-insensitively" - stored slugs are lowercase. */
const normalizeSlug = (slug: string): string => slug.trim().toLowerCase();

/**
 * `media` row → the `MediaRowLike` shape ./media maps from. The two jsonb columns are typed more
 * loosely in @namilux/db (`avif`/`webp` optional, `reason: string | null`), so the repo boundary - 
 * this function - is where they are normalized; ./media itself re-checks every value at runtime.
 * DECISION: local here and in ./collections because products.repo.ts, the file whose contract owns
 * `MediaRowLike`, was not yet built when this was written and exports no such mapper.
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

function logoOf(row: MediaRow | null, altFallback: string): ImageRef | null {
  if (row === null) return null;
  return toImageRef(mediaRowLike(row), { altFallback });
}

/**
 * DECISION: `SeoFields.canonical` carries the DECODED site path (products.service.ts spells the same
 * rule); seo/metadata.ts encodes it. A brand slug is Latin, so `brandUrl(slug)` and the decoded path
 * are byte-identical - the URL helper is used anyway so no path is ever minted outside url/*.
 */
function seoFor(row: BrandRow, logo: ImageRef | null): SeoFields {
  const title = row.seoTitle?.trim() ?? "";
  const description = row.seoDescription?.trim() ?? "";
  const robots = row.robots.trim();
  return {
    title: title === "" ? `${row.nameFa}${SITE_TITLE_SUFFIX}` : title,
    description: description === "" ? null : description,
    robots: robots === "" ? DEFAULT_ROBOTS : robots,
    canonical: brandUrl(row.slug),
    // rules: "ogImagePath = seo/og.ogImagePath({kind:'brand', id}) when a logo exists, else the site
    // fallback". DECISION: seo/og.ts was not yet built when this was written and every export throws, so the logo's own
    // (first-party, content-hashed) storage key stands in for the generated card and `null` means
    // the site default. Swap for `ogKeyFor({ kind: "brand", id })` when og.ts lands.
    ogImage: logo === null ? null : logo.key,
    // the spec: legacy_lastmod until the row is edited after launch, then updated_at.
    lastmod: (row.legacyLastmod ?? row.updatedAt).toISOString(),
  };
}

// ---------------------------------------------------------------- counts

/**
 * DISTINCT is unnecessary (a product has exactly one brand_id), so both numbers come from one pass
 * over the brand's active+public products. `where` restricts the scan when a single brand is asked.
 */
async function countsFor(db: Db, brandId: number | null): Promise<Map<number, BrandCounts>> {
  const scope = brandId === null ? sql`` : sql` and b.id = ${brandId}`;
  const rows = (await db.execute(sql`
    select b.id as id,
           count(p.id)::int as total,
           count(p.id) filter (where p.price > 0 and ${AVAILABLE_SQL})::int as buyable
      from brands b
      left join products p
        on p.brand_id = b.id and p.status = 'active' and p.visibility = 'public'
     where true${scope}
     group by b.id
  `)) as unknown as { id: number; total: number; buyable: number }[];
  const out = new Map<number, BrandCounts>();
  for (const r of rows) out.set(Number(r.id), { total: Number(r.total), buyable: Number(r.buyable) });
  return out;
}

const countsOf = (counts: Map<number, BrandCounts>, id: number): BrandCounts =>
  counts.get(id) ?? { total: 0, buyable: 0 };

// ---------------------------------------------------------------- read side

export async function getBrandBySlug(db: Db, slug: string): Promise<BrandView | null> {
  const wanted = normalizeSlug(slug);
  if (wanted === "") return null;

  const rows = await db
    .select({ brand: brandsTable, logo: mediaTable })
    .from(brandsTable)
    .leftJoin(mediaTable, eq(mediaTable.id, brandsTable.logoMediaId))
    .where(eq(brandsTable.slug, wanted))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // rules: an inactive brand is not served; the router then consults redirects (archive.ts wrote one).
  if (!row.brand.isActive) return null;

  const logo = logoOf(row.logo, row.brand.nameFa);
  const counts = countsOf(await countsFor(db, row.brand.id), row.brand.id);

  return {
    id: row.brand.id,
    slug: row.brand.slug,
    nameFa: row.brand.nameFa,
    nameEn: row.brand.nameEn,
    claim: row.brand.claim,
    // the spec: sanitized at write; RichHtml sanitizes again at render.
    storyHtml: row.brand.storyHtml ?? "",
    logo,
    isActive: row.brand.isActive,
    productCount: counts.total,
    // rules: `comingSoon` = isActive && buyableCount === 0 - derived by the page from these two.
    buyableCount: counts.buyable,
    seo: seoFor(row.brand, logo),
  };
}

export async function listBrands(db: Db, opts?: { activeOnly?: boolean }): Promise<BrandSummary[]> {
  const rows = await db
    .select({ brand: brandsTable, logo: mediaTable })
    .from(brandsTable)
    .leftJoin(mediaTable, eq(mediaTable.id, brandsTable.logoMediaId));
  const counts = await countsFor(db, null);

  const summaries: BrandSummary[] = [];
  for (const row of rows) {
    if (opts?.activeOnly === true && !row.brand.isActive) continue;
    const c = countsOf(counts, row.brand.id);
    summaries.push({
      id: row.brand.id,
      slug: row.brand.slug,
      name: row.brand.nameFa,
      nameEn: row.brand.nameEn,
      logo: logoOf(row.logo, row.brand.nameFa),
      productCount: c.total,
      buyableCount: c.buyable,
      isActive: row.brand.isActive,
      sort: row.brand.sort,
    });
  }

  // EDGE CASE: "listBrands ordering: sort asc, then productCount desc, then nameEn". The last key
  // makes the order total, so paging and cache keys are stable.
  return summaries.sort(
    (a, b) => a.sort - b.sort || b.productCount - a.productCount || a.nameEn.localeCompare(b.nameEn, "en"),
  );
}

// ---------------------------------------------------------------- write side

const isLegacyBrandId = (id: number): boolean => Object.values(LEGACY_BRAND_IDS).includes(id);

export async function upsertBrand(
  db: Db,
  input: BrandInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const slug = normalizeSlug(input.slug);
  // EDGE CASE: a slug with Persian letters or spaces → VALIDATION (the spec: brand slugs are Latin).
  if (!isLatinSlug(slug)) {
    throw appError("VALIDATION", { details: { field: "slug", reason: "not_latin_slug" } });
  }
  const nameFa = faZwnj(input.nameFa.trim());
  const nameEn = input.nameEn.trim();
  if (nameFa === "" || nameEn === "") {
    throw appError("VALIDATION", { details: { field: nameFa === "" ? "nameFa" : "nameEn", reason: "required" } });
  }
  // `claim` is nullable AND optional in the schema, so both shapes have to fold to the empty string.
  const claim = faZwnj((input.claim ?? "").trim());
  const storyHtml = sanitizeHtml(input.storyHtml ?? "");
  const robots = input.robots.trim() === "" ? DEFAULT_ROBOTS : input.robots.trim();
  const sort = Number.isSafeInteger(input.sort) ? input.sort : 0;

  const values = {
    slug,
    nameFa,
    nameEn,
    claim: claim === "" ? null : claim,
    storyHtml,
    logoMediaId: input.logoMediaId,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    robots,
    isActive: input.isActive,
    sort,
  };

  const id = await db.transaction(async (tx) => {
    const clash = await tx
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .where(eq(brandsTable.slug, slug))
      .limit(1);
    const taken = clash[0];

    if (input.id === undefined) {
      if (taken !== undefined) {
        throw appError("CONFLICT", { details: { field: "slug", reason: "slug_taken", slug } });
      }
      const inserted = await tx.insert(brandsTable).values(values).returning({ id: brandsTable.id });
      const created = inserted[0];
      if (created === undefined) throw appError("INTERNAL", { details: { reason: "insert_returned_nothing" } });
      await audit.log(tx, actor, "brand.create", "brand", String(created.id), undefined, values);
      return created.id;
    }

    const before = (
      await tx.select().from(brandsTable).where(eq(brandsTable.id, input.id)).limit(1)
    )[0];
    if (before === undefined) throw appError("NOT_FOUND", { details: { entity: "brand", id: input.id } });
    if (taken !== undefined && taken.id !== before.id) {
      throw appError("CONFLICT", { details: { field: "slug", reason: "slug_taken", slug } });
    }
    // rules / the spec: the 7 legacy brand URLs are frozen.
    if (slug !== before.slug && isLegacyBrandId(before.id)) {
      throw appError("CONFLICT", { details: { field: "slug", reason: "legacy_slug_immutable", id: before.id } });
    }

    await tx.update(brandsTable).set(values).where(eq(brandsTable.id, before.id));

    if (slug !== before.slug) {
      // DECISION: a slug change on a NEW brand inserts the redirect itself, per the cross-entity
      // rule of validation/content.ts rules ("if a slug changes, the service inserts a redirect
      // automatically", the spec §1.6). This header only fixes the legacy CONFLICT, but leaving
      // the old URL dead would violate the spec for every brand the owner adds after launch.
      // An existing row for that from_path is left as it is (see ./categories.redirectOldPath).
      try {
        await insertRedirect(
          tx,
          { fromPath: brandUrl(before.slug), toPath: brandUrl(slug), code: 301, source: "manual" },
          actor,
        );
      } catch (err: unknown) {
        if (!isAppError(err) || err.code !== "CONFLICT") throw err;
      }
    }

    await audit.log(tx, actor, "brand.update", "brand", String(before.id), before, values);
    return before.id;
  });

  // rules: brand(id) + nav + catalog + home + sitemap.
  // DECISION: built from ../cache/tags rather than ../cache/invalidation.tagsForBrandChange (named
  // in dependency list) because that function was not yet built when this was written and throws.
  return {
    id,
    tags: [cacheTags.brand(id), cacheTags.nav, cacheTags.catalog, cacheTags.home, cacheTags.sitemap],
  };
}
