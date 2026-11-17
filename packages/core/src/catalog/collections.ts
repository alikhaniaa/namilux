import {
  collectionProducts as collectionProductsTable,
  collections as collectionsTable,
  eq,
  inArray,
  media as mediaTable,
  sql,
} from "@namilux/db";
import type { CollectionRule as DbCollectionRule, Db, Row, SQL } from "@namilux/db";
// DECISION (M0 step 3): CollectionKind/CollectionStatus live in ../constants and CollectionRule /
// CollectionView in ../types; `collectionRuleSchema` is owned by ../validation/catalog-admin.ts
// (the spec §validation - every request schema lives in the validation namespace, and
// apps/admin/api/collections/preview validates its body with it). This module consumes them.
import type { CollectionKind, CollectionStatus } from "../constants";
import type { Actor, CollectionCard, CollectionRule, CollectionView, SeoFields } from "../types";
import { collectionRuleSchema } from "../validation/catalog-admin";
import type { ImageRef, MediaRowLike } from "./media";
import { toImageRef } from "./media";
import type { WhereTerm } from "./list";
import { appError, isAppError } from "../errors";
import { faZwnj } from "../persian";
import { sanitizeHtml } from "../html";
import { collectionUrl } from "../url";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { tags as cacheTags } from "../cache/tags";
import { insertRedirect } from "../content/redirects";

export { collectionRuleSchema };

export type RuleProductFacts = {
  brandId: number | null;
  categoryIds: number[];
  price: number;
  compareAtPrice: number | null;
  available: boolean;
};

export type CollectionTile = {
  id: number;
  slug: string;
  name: string;
  kind: CollectionKind;
  cover: ImageRef | null;
  coverDark: ImageRef | null;
  productCount: number;
  parentId: number | null;
  sort: number;
};

export type CollectionInput = {
  id?: number;
  slug: string;
  name: string;
  kind: CollectionKind;
  parentId: number | null;
  rule: CollectionRule | null;
  productIds: number[] | null;
  coverMediaId: string | null;
  coverDarkMediaId: string | null;
  descriptionHtml: string;
  seoTitle: string | null;
  seoDescription: string | null;
  isNav: boolean;
  startsAt: string | null;
  endsAt: string | null;
  status: CollectionStatus;
  sort: number;
};

// ---------------------------------------------------------------- constants

const SITE_TITLE_SUFFIX = " - نامی لوکس";
const DEFAULT_ROBOTS = "index, follow";
/** rules: an active-but-ended (or not-yet-started) campaign is served, but never indexed. */
const NOT_LIVE_ROBOTS = "noindex, follow";

/** validation/common.ts zLatinSlug verbatim. */
const LATIN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LATIN_SLUG_MAX = 80;

/** the spec "rule builder with live count and preview grid" - the grid shows one screen of cards. */
const RULE_PREVIEW_SAMPLE = 24;

/** Recursion guard for the parent walk (a data cycle must not hang a request). */
const MAX_TREE_DEPTH = 32;

/** See ./brands - the availability predicate of products.repo.ts rules over the alias `p`. */
const AVAILABLE_SQL = sql`(p.stock_policy = 'untracked' or p.allow_backorder or (p.stock_qty - coalesce((select sum(r.qty) from inventory_reservations r where r.product_id = p.id and r.released_at is null and r.consumed_at is null), 0)) >= 1)`;

/** Base scope of every membership query: only listable rows are ever members (list.ts `base` term). */
const PUBLIC_SQL = sql`p.status = 'active' and p.visibility = 'public'`;

type CollectionRow = Row<typeof collectionsTable>;
type MediaRow = Row<typeof mediaTable>;
type JoinedRow = { collection: CollectionRow; cover: MediaRow | null; coverDark: MediaRow | null };

// ---------------------------------------------------------------- the rule (pure)

/**
 * DECISION: `onSale: false` / `inStock: false` are treated as ABSENT by both evaluators rather than
 * as negations. The `WhereTerm` vocabulary of ./list has no negated term, so a "not on sale" rule
 * could never be expressed as a plan and the two evaluators - which the header requires to have the
 * "same semantics" - would drift. The admin renders each flag as an opt-in checkbox ("only on
 * sale", "only in stock"), which is exactly this reading.
 *
 * DECISION: an EMPTY array (`{ brandIds: [] }`) is a present key that matches NOTHING, not an
 * absent filter. Fail closed: a mis-serialized rule empties a collection instead of publishing the
 * whole catalogue under a campaign headline. `{}` (no keys at all) still matches everything, per
 * the edge cases.
 */
export function ruleMatches(rule: CollectionRule, p: RuleProductFacts): boolean {
  if (rule.brandIds !== undefined) {
    if (p.brandId === null || !rule.brandIds.includes(p.brandId)) return false;
  }
  if (rule.categoryIds !== undefined) {
    // The facts carry the product's categories INCLUDING their ancestors, so a rule naming a parent
    // matches a product filed under a descendant (edge cases).
    if (!rule.categoryIds.some((id) => p.categoryIds.includes(id))) return false;
  }
  if (rule.priceMin !== undefined || rule.priceMax !== undefined) {
    // EDGE CASE: on-request rows (price 0) are excluded whenever a price bound is set.
    if (p.price <= 0) return false;
    if (rule.priceMin !== undefined && p.price < rule.priceMin) return false;
    if (rule.priceMax !== undefined && p.price > rule.priceMax) return false;
  }
  if (rule.onSale === true) {
    if (!(p.compareAtPrice !== null && p.price > 0 && p.compareAtPrice > p.price)) return false;
  }
  // EDGE CASE: an available on-request product IS in stock (availability and price are independent).
  if (rule.inStock === true && !p.available) return false;
  // rules: `tags` is reserved and ignored at P0.
  return true;
}

export function ruleToPlan(rule: CollectionRule): WhereTerm[] {
  const terms: WhereTerm[] = [];
  if (rule.brandIds !== undefined) terms.push({ kind: "brand_in", ids: [...rule.brandIds] });
  // list.ts resolves `category_in` to the category AND its descendants, which is what the ancestor
  // carrying facts of `ruleMatches` express on the other side.
  if (rule.categoryIds !== undefined) terms.push({ kind: "category_in", ids: [...rule.categoryIds] });
  if (rule.priceMin !== undefined || rule.priceMax !== undefined) {
    // `price_between` already implies `price > 0` (./list WhereTerm).
    terms.push({ kind: "price_between", min: rule.priceMin ?? null, max: rule.priceMax ?? null });
  }
  if (rule.onSale === true) terms.push({ kind: "sale" });
  if (rule.inStock === true) terms.push({ kind: "avail", keys: ["in"] });
  return terms;
}

/**
 * rules / DECISION: `tags` must be absent or empty. `collectionRuleSchema` is owned by
 * ../validation/catalog-admin.ts, whose own contract still accepts up to 20 tags, so
 * the guard lives on this side of the boundary: no rule carrying tags is ever counted or stored,
 * and "nobody believes a tag rule works".
 */
function assertNoTags(rule: CollectionRule): void {
  if (rule.tags !== undefined && rule.tags.length > 0) {
    throw appError("VALIDATION", { details: { field: "rule.tags", reason: "tags_not_supported" } });
  }
}

/**
 * DECISION: the window predicate is a private helper, not an export - ../content/banners.ts owns the
 * exported `isLive` (this module's own M0 step-3 note) and `export *` would collide. It is not
 * DELEGATED to that module either, because every export of banners.ts still threw when this was written and a
 * collection page must not depend on an unrelated module's implementation status. The two headers
 * spell the predicate identically: active AND startsAt ≤ at AND at < endsAt; nulls are open.
 */
function isLiveWindow(
  c: { status: CollectionStatus; startsAt: Date | null; endsAt: Date | null },
  at: Date,
): boolean {
  if (c.status !== "active") return false;
  const now = at.getTime();
  if (c.startsAt !== null && c.startsAt.getTime() > now) return false;
  // EDGE CASE: endsAt exactly `at` → not live (half-open [startsAt, endsAt)).
  if (c.endsAt !== null && c.endsAt.getTime() <= now) return false;
  return true;
}

// ---------------------------------------------------------------- sql helpers

/** A bound `IN (…)` list - every id is a parameter, never interpolated text. */
const idList = (ids: readonly number[]): SQL => sql.join(ids.map((id) => sql`${id}`), sql`, `);

const cleanIds = (ids: readonly number[] | undefined): number[] => {
  const out: number[] = [];
  for (const id of ids ?? []) {
    if (Number.isSafeInteger(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
};

/** The category ids a rule names, plus every descendant - the SQL twin of "facts carry ancestors". */
async function expandCategoryIds(db: Db, ids: readonly number[]): Promise<number[]> {
  const roots = cleanIds(ids);
  if (roots.length === 0) return [];
  const rows = (await db.execute(sql`
    with recursive tree as (
      select id from categories where id in (${idList(roots)})
      union
      select c.id from categories c join tree t on c.parent_id = t.id
    )
    select id from tree
  `)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}

/** `ruleMatches` as SQL over the alias `p`. An empty/unknown id set yields `false` (fail closed). */
function ruleConditions(rule: CollectionRule, expandedCategoryIds: readonly number[]): SQL[] {
  const parts: SQL[] = [];
  if (rule.brandIds !== undefined) {
    const ids = cleanIds(rule.brandIds);
    parts.push(ids.length === 0 ? sql`false` : sql`p.brand_id in (${idList(ids)})`);
  }
  if (rule.categoryIds !== undefined) {
    parts.push(
      expandedCategoryIds.length === 0
        ? sql`false`
        : sql`exists (select 1 from product_categories pc where pc.product_id = p.id and pc.category_id in (${idList(expandedCategoryIds)}))`,
    );
  }
  if (rule.priceMin !== undefined || rule.priceMax !== undefined) {
    parts.push(sql`p.price > 0`);
    if (rule.priceMin !== undefined) parts.push(sql`p.price >= ${rule.priceMin}`);
    if (rule.priceMax !== undefined) parts.push(sql`p.price <= ${rule.priceMax}`);
  }
  if (rule.onSale === true) {
    parts.push(sql`(p.compare_at_price is not null and p.price > 0 and p.compare_at_price > p.price)`);
  }
  if (rule.inStock === true) parts.push(AVAILABLE_SQL);
  return parts;
}

const allOf = (parts: readonly SQL[]): SQL =>
  parts.length === 0 ? sql`true` : sql.join([...parts], sql` and `);

/**
 * `collections.rule_json` is typed by @namilux/db without `| undefined` on its optional keys, so
 * under `exactOptionalPropertyTypes` a zod-inferred rule cannot be handed over verbatim: absent
 * keys are OMITTED here rather than written as `undefined` (which would also serialize `null`s into
 * the jsonb document and change what `ruleMatches` sees on the way back).
 */
function toStoredRule(rule: CollectionRule | null): DbCollectionRule | null {
  if (rule === null) return null;
  return {
    ...(rule.brandIds === undefined ? {} : { brandIds: rule.brandIds }),
    ...(rule.categoryIds === undefined ? {} : { categoryIds: rule.categoryIds }),
    ...(rule.priceMin === undefined ? {} : { priceMin: rule.priceMin }),
    ...(rule.priceMax === undefined ? {} : { priceMax: rule.priceMax }),
    ...(rule.onSale === undefined ? {} : { onSale: rule.onSale }),
    ...(rule.inStock === undefined ? {} : { inStock: rule.inStock }),
  };
}

async function ruleWhere(db: Db, rule: CollectionRule): Promise<SQL> {
  const expanded = rule.categoryIds === undefined ? [] : await expandCategoryIds(db, rule.categoryIds);
  return allOf(ruleConditions(rule, expanded));
}

// ---------------------------------------------------------------- media

/** See ./brands.mediaRowLike - the same repo-boundary normalization of the two jsonb columns. */
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

const coverOf = (row: MediaRow | null, altFallback: string): ImageRef | null =>
  row === null ? null : toImageRef(mediaRowLike(row), { altFallback });

// ---------------------------------------------------------------- membership counts

/** Manual members (active+public only) of every given collection, in one statement. */
async function manualCounts(db: Db, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = (await db.execute(sql`
    select cp.collection_id as id, count(*)::int as n
      from collection_products cp
      join products p on p.id = cp.product_id and ${PUBLIC_SQL}
     where cp.collection_id in (${idList(ids)})
     group by cp.collection_id
  `)) as unknown as { id: number; n: number }[];
  for (const r of rows) out.set(Number(r.id), Number(r.n));
  return out;
}

/** manual ∪ rule for ONE collection - the union has to be de-duplicated, so it is one query. */
async function memberCount(db: Db, id: number, rule: CollectionRule | null): Promise<number> {
  if (rule === null) return (await manualCounts(db, [id])).get(id) ?? 0;
  const where = await ruleWhere(db, rule);
  const rows = (await db.execute(sql`
    select count(*)::int as n
      from products p
     where ${PUBLIC_SQL}
       and (exists (select 1 from collection_products cp where cp.collection_id = ${id} and cp.product_id = p.id)
            or (${where}))
  `)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * Counts for a batch of collections: one grouped query for the manual members, then one query per
 * RULE-bearing collection (the union needs de-duplication and a rule is not expressible in the
 * grouped form). Seeded collections are all manual (the spec seed note), so the loop is normally empty.
 */
async function countsFor(db: Db, rows: readonly CollectionRow[]): Promise<Map<number, number>> {
  const counts = await manualCounts(db, rows.map((r) => r.id));
  for (const row of rows) {
    if (row.ruleJson == null) {
      if (!counts.has(row.id)) counts.set(row.id, 0);
      continue;
    }
    counts.set(row.id, await memberCount(db, row.id, row.ruleJson));
  }
  return counts;
}

// ---------------------------------------------------------------- mapping

function seoFor(row: CollectionRow, cover: ImageRef | null, live: boolean): SeoFields {
  const title = row.seoTitle?.trim() ?? "";
  const description = row.seoDescription?.trim() ?? "";
  return {
    title: title === "" ? `${row.name}${SITE_TITLE_SUFFIX}` : title,
    description: description === "" ? null : description,
    // rules: an ended / not-yet-started campaign is served with an "ended" state and noindex.
    // DECISION: `CollectionView` (../types) has no `live` / `robots` slot of its own, so the
    // not-live signal is carried where the router actually needs it - `seo.robots` - and the page
    // re-derives `live` from `status` + `startsAt`/`endsAt`, which the view does carry.
    robots: live ? DEFAULT_ROBOTS : NOT_LIVE_ROBOTS,
    // Decoded site path; seo/metadata.ts encodes it. A collection slug is Latin, so `collectionUrl`
    // returns the same bytes - and no path is minted outside url/*.
    canonical: collectionUrl(row.slug),
    // DECISION: seo/og.ts was not yet built when this was written (every export throws), so the light cover's own
    // first-party storage key stands in for the generated OG card; null = site default.
    ogImage: cover === null ? null : cover.key,
    lastmod: row.updatedAt.toISOString(),
  };
}

function toTile(row: JoinedRow, count: number): CollectionTile {
  return {
    id: row.collection.id,
    slug: row.collection.slug,
    name: row.collection.name,
    kind: row.collection.kind,
    cover: coverOf(row.cover, row.collection.name),
    coverDark: coverOf(row.coverDark, row.collection.name),
    productCount: count,
    parentId: row.collection.parentId,
    sort: row.collection.sort,
  };
}

function toCard(row: JoinedRow, count: number): CollectionCard {
  return {
    id: row.collection.id,
    slug: row.collection.slug,
    name: row.collection.name,
    kind: row.collection.kind,
    cover: coverOf(row.cover, row.collection.name),
    coverDark: coverOf(row.coverDark, row.collection.name),
    count,
  };
}

// ---------------------------------------------------------------- read side

/**
 * Rows + their two cover media rows. The light and the dark cover are two rows of the SAME table,
 * so instead of a self-join with an alias the media are fetched once by id - one extra statement,
 * never one per collection (products.repo rules: never N+1).
 */
async function loadCollections(db: Db, ids: readonly number[] | null): Promise<JoinedRow[]> {
  const base = db.select().from(collectionsTable);
  const rows = ids === null ? await base : ids.length === 0 ? [] : await base.where(inArray(collectionsTable.id, [...ids]));
  if (rows.length === 0) return [];

  const mediaIds = new Set<string>();
  for (const row of rows) {
    if (row.coverMediaId !== null) mediaIds.add(row.coverMediaId);
    if (row.coverDarkMediaId !== null) mediaIds.add(row.coverDarkMediaId);
  }
  const byMediaId = new Map<string, MediaRow>();
  if (mediaIds.size > 0) {
    const found = await db.select().from(mediaTable).where(inArray(mediaTable.id, [...mediaIds]));
    for (const m of found) byMediaId.set(m.id, m);
  }

  return rows.map((collection) => ({
    collection,
    cover: collection.coverMediaId === null ? null : byMediaId.get(collection.coverMediaId) ?? null,
    coverDark:
      collection.coverDarkMediaId === null ? null : byMediaId.get(collection.coverDarkMediaId) ?? null,
  }));
}

const bySortThenName = (a: { sort: number; name: string }, b: { sort: number; name: string }): number =>
  a.sort - b.sort || a.name.localeCompare(b.name, "fa");

export async function getCollectionBySlug(
  db: Db,
  slug: string,
  at?: Date,
): Promise<CollectionView | null> {
  const wanted = slug.trim().toLowerCase();
  if (wanted === "") return null;
  const now = at ?? new Date();

  const rows = await db.select().from(collectionsTable).where(eq(collectionsTable.slug, wanted)).limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // rules: draft / archived → null (the campaign that never launched has no page).
  if (row.status !== "active") return null;

  const [self] = await loadCollections(db, [row.id]);
  if (self === undefined) return null;

  const childRows = await db
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.parentId, row.id));
  // DECISION: only LIVE children are linked - a draft or ended sub-collection must not be offered
  // as a tile (listCollections applies the same rule).
  const liveChildren = childRows
    .filter((c) => isLiveWindow(c, now))
    .sort(bySortThenName);
  const childJoined = await loadCollections(db, liveChildren.map((c) => c.id));
  const counts = await countsFor(db, [row, ...liveChildren]);
  const order = new Map(liveChildren.map((c, i) => [c.id, i]));
  const children = childJoined
    .sort((a, b) => (order.get(a.collection.id) ?? 0) - (order.get(b.collection.id) ?? 0))
    .map((c) => toCard(c, counts.get(c.collection.id) ?? 0));

  const live = isLiveWindow(row, now);
  const cover = coverOf(self.cover, row.name);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    cover,
    coverDark: coverOf(self.coverDark, row.name),
    count: counts.get(row.id) ?? 0,
    descriptionHtml: row.descriptionHtml ?? "",
    status: row.status,
    parentId: row.parentId,
    children,
    startsAt: row.startsAt === null ? null : row.startsAt.toISOString(),
    endsAt: row.endsAt === null ? null : row.endsAt.toISOString(),
    seo: seoFor(row, cover, live),
  };
}

export async function listCollections(
  db: Db,
  opts?: { kinds?: CollectionKind[]; navOnly?: boolean; at?: Date },
): Promise<CollectionTile[]> {
  const now = opts?.at ?? new Date();
  const kinds = opts?.kinds;
  const all = await db.select().from(collectionsTable);
  const live = all
    .filter((c) => isLiveWindow(c, now))
    .filter((c) => kinds === undefined || kinds.includes(c.kind))
    .filter((c) => opts?.navOnly !== true || c.isNav)
    .sort(bySortThenName);
  if (live.length === 0) return [];

  const [joined, counts] = await Promise.all([
    loadCollections(db, live.map((c) => c.id)),
    countsFor(db, live),
  ]);
  const order = new Map(live.map((c, i) => [c.id, i]));
  return joined
    .sort((a, b) => (order.get(a.collection.id) ?? 0) - (order.get(b.collection.id) ?? 0))
    .map((row) => toTile(row, counts.get(row.collection.id) ?? 0));
}

export async function collectionProductIds(db: Db, id: number): Promise<number[]> {
  const rows = await db.select().from(collectionsTable).where(eq(collectionsTable.id, id)).limit(1);
  const row = rows[0];
  if (row === undefined) return [];

  // EDGE CASE: a manual member that is archived (or draft/hidden) is excluded - membership never
  // widens what the PLP is allowed to list (list.ts `base` term).
  const manual = (await db.execute(sql`
    select cp.product_id as id
      from collection_products cp
      join products p on p.id = cp.product_id and ${PUBLIC_SQL}
     where cp.collection_id = ${id}
     order by cp.sort asc, cp.product_id asc
  `)) as unknown as { id: number }[];

  const out: number[] = [];
  const seen = new Set<number>();
  for (const r of manual) {
    const productId = Number(r.id);
    if (seen.has(productId)) continue;
    seen.add(productId);
    out.push(productId);
  }

  if (row.ruleJson == null) return out;
  const where = await ruleWhere(db, row.ruleJson);
  const matched = (await db.execute(sql`
    select p.id as id from products p where ${PUBLIC_SQL} and (${where}) order by p.id desc
  `)) as unknown as { id: number }[];
  for (const r of matched) {
    const productId = Number(r.id);
    if (seen.has(productId)) continue;
    seen.add(productId);
    out.push(productId);
  }
  return out;
}

export async function previewRuleCount(
  db: Db,
  rule: CollectionRule,
): Promise<{ count: number; sampleIds: number[] }> {
  assertNoTags(rule);
  const where = await ruleWhere(db, rule);
  const rows = (await db.execute(sql`
    select p.id as id, count(*) over ()::int as total
      from products p
     where ${PUBLIC_SQL} and (${where})
     order by p.id desc
     limit ${RULE_PREVIEW_SAMPLE}
  `)) as unknown as { id: number; total: number }[];
  return {
    count: Number(rows[0]?.total ?? 0),
    sampleIds: rows.map((r) => Number(r.id)),
  };
}

// ---------------------------------------------------------------- write side

function assertLatinSlug(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (s.length > LATIN_SLUG_MAX || !LATIN_SLUG_RE.test(s)) {
    throw appError("VALIDATION", { details: { field: "slug", reason: "not_latin_slug" } });
  }
  return s;
}

function parseAt(value: string | null, field: "startsAt" | "endsAt"): Date | null {
  if (value === null) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw appError("VALIDATION", { details: { field, reason: "invalid_date" } });
  return at;
}

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null ? b === null : b !== null && a.getTime() === b.getTime();

/** Parent ids up to the root - a parent's tile shows the child's count, so it is invalidated too. */
async function parentChain(db: Db, id: number): Promise<number[]> {
  const rows = (await db.execute(sql`
    with recursive up as (
      select id, parent_id, 0 as depth from collections where id = ${id}
      union all
      select c.id, c.parent_id, u.depth + 1
        from collections c join up u on c.id = u.parent_id
       where u.depth < ${MAX_TREE_DEPTH}
    )
    select id from up where depth > 0 order by depth asc
  `)) as unknown as { id: number }[];
  return rows.map((r) => Number(r.id));
}

export async function upsertCollection(
  db: Db,
  input: CollectionInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const slug = assertLatinSlug(input.slug);
  const name = faZwnj(input.name.trim());
  if (name === "") throw appError("VALIDATION", { details: { field: "name", reason: "required" } });
  if (input.rule !== null) assertNoTags(input.rule);
  const descriptionHtml = sanitizeHtml(input.descriptionHtml ?? "");
  const startsAt = parseAt(input.startsAt, "startsAt");
  const endsAt = parseAt(input.endsAt, "endsAt");
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw appError("VALIDATION", { details: { field: "endsAt", reason: "window_inverted" } });
  }
  const sort = Number.isSafeInteger(input.sort) ? input.sort : 0;

  const values = {
    slug,
    parentId: input.parentId,
    name,
    kind: input.kind,
    ruleJson: toStoredRule(input.rule),
    coverMediaId: input.coverMediaId,
    coverDarkMediaId: input.coverDarkMediaId,
    descriptionHtml,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    isNav: input.isNav,
    startsAt,
    endsAt,
    status: input.status,
    sort,
  };

  const result = await db.transaction(async (tx) => {
    if (input.parentId !== null) {
      const parent = await tx
        .select({ id: collectionsTable.id })
        .from(collectionsTable)
        .where(eq(collectionsTable.id, input.parentId))
        .limit(1);
      if (parent[0] === undefined) {
        throw appError("VALIDATION", { details: { field: "parentId", reason: "unknown_parent" } });
      }
    }

    const clash = (
      await tx.select({ id: collectionsTable.id }).from(collectionsTable).where(eq(collectionsTable.slug, slug)).limit(1)
    )[0];

    let id: number;
    let scheduleChanged: boolean;
    let previousParentId: number | null = null;

    if (input.id === undefined) {
      if (clash !== undefined) {
        throw appError("CONFLICT", { details: { field: "slug", reason: "slug_taken", slug } });
      }
      const inserted = await tx.insert(collectionsTable).values(values).returning({ id: collectionsTable.id });
      const created = inserted[0];
      if (created === undefined) throw appError("INTERNAL", { details: { reason: "insert_returned_nothing" } });
      id = created.id;
      scheduleChanged = startsAt !== null || endsAt !== null;
      await audit.log(tx, actor, "collection.create", "collection", String(id), undefined, values);
    } else {
      const before = (
        await tx.select().from(collectionsTable).where(eq(collectionsTable.id, input.id)).limit(1)
      )[0];
      if (before === undefined) {
        throw appError("NOT_FOUND", { details: { entity: "collection", id: input.id } });
      }
      if (clash !== undefined && clash.id !== before.id) {
        throw appError("CONFLICT", { details: { field: "slug", reason: "slug_taken", slug } });
      }
      if (input.parentId !== null) {
        const chain = await parentChain(tx, input.parentId);
        if (input.parentId === before.id || chain.includes(before.id)) {
          throw appError("VALIDATION", { details: { field: "parentId", reason: "cycle" } });
        }
      }
      id = before.id;
      previousParentId = before.parentId;
      scheduleChanged = !sameInstant(before.startsAt, startsAt) || !sameInstant(before.endsAt, endsAt);

      await tx.update(collectionsTable).set(values).where(eq(collectionsTable.id, id));

      if (slug !== before.slug) {
        // the spec / validation/content.ts rules: a slug change inserts the redirect automatically.
        try {
          await insertRedirect(
            tx,
            { fromPath: collectionUrl(before.slug), toPath: collectionUrl(slug), code: 301, source: "manual" },
            actor,
          );
        } catch (err: unknown) {
          if (!isAppError(err) || err.code !== "CONFLICT") throw err;
        }
      }
      await audit.log(tx, actor, "collection.update", "collection", String(id), before, values);
    }

    // rules: "`productIds` given → membership replaced in one tx"; null leaves it untouched.
    if (input.productIds !== null) {
      const ids = cleanIds(input.productIds);
      await tx.delete(collectionProductsTable).where(eq(collectionProductsTable.collectionId, id));
      if (ids.length > 0) {
        await tx
          .insert(collectionProductsTable)
          .values(ids.map((productId, index) => ({ collectionId: id, productId, sort: index })));
      }
    }

    return { id, scheduleChanged, previousParentId };
  });

  // rules: two `cache.revalidate` jobs so a scheduled campaign flips without an admin action.
  if (result.scheduleChanged) {
    const revalidateTags = [cacheTags.collection(result.id), cacheTags.nav, cacheTags.catalog, cacheTags.home];
    for (const [boundary, runAt] of [
      ["start", startsAt],
      ["end", endsAt],
    ] as const) {
      if (runAt === null) continue;
      await jobs.enqueue(
        db,
        "cache.revalidate",
        { collectionId: result.id, boundary, tags: revalidateTags },
        { uniqueKey: `collection:${result.id}:${boundary}`, runAt },
      );
    }
  }

  // rules: collection(id) + parent collection tag + nav + catalog + home + sitemap.
  const ids = new Set<number>([result.id]);
  if (input.parentId !== null) ids.add(input.parentId);
  if (result.previousParentId !== null) ids.add(result.previousParentId);

  return {
    id: result.id,
    tags: [
      ...[...ids].map((id) => cacheTags.collection(id)),
      cacheTags.nav,
      cacheTags.catalog,
      cacheTags.home,
      cacheTags.sitemap,
    ],
  };
}
