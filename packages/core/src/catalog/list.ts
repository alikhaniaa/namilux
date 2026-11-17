import type { Db } from "@namilux/db";
import type { PlpState, SortKey } from "../url";
import { activeFilterCount, normalizePlpState } from "../url";
import { appError } from "../errors";
import { faNorm } from "../persian";
import { PLP_MAX_PAGE, PLP_PAGE_SIZE } from "../constants";
import type { ProductScopeKind } from "../constants";
import type { OrderByTerm } from "./sort";
import { DEFAULT_SORT, isSortKey, orderByPlan } from "./sort";
import type { ProductCard } from "./cards";
import { toProductCard } from "./cards";
import type { Facets } from "./facets";
import { computeFacets, facetScopeKey, pruneFacets } from "./facets";
import { descendantIds } from "./categories";
import { listBrands } from "./brands";
import { listCollections } from "./collections";
import { findCardSources, queryCards } from "./products.repo";

// DECISION: re-exported from ../constants rather than declared twice - `constants.PLP_PAGE_SIZE`
// / `PLP_MAX_PAGE` were aligned to these values at M1 so `url/plp-state.ts` (which clamps `?page=`)
// and this planner agree; a URL can no longer parse to a page the planner then 404s.
export const PAGE_SIZE = PLP_PAGE_SIZE;
export const MAX_PAGE = PLP_MAX_PAGE;
export const NEW_SCOPE_DAYS = 30;

// DECISION (M0 step 3): Paged / ProductScope / ProductQuery are declared once in ../types (the spec
// §catalog). Re-exported here because ./facets, ./bulk-price, ./import-csv and ../content/posts
// import them from this module.
import type { Paged, ProductQuery, ProductScope } from "../types";

export type { Paged, ProductQuery, ProductScope };

// DECISION: the contract prints the eight kinds as a literal union; ../constants already owns that
// list as PRODUCT_SCOPE_KINDS / ProductScopeKind (it is what ProductScope.kind is typed with), so
// ScopeKind is an alias of it: the identical type, one declaration site, no drift.
export type ScopeKind = ProductScopeKind;

export type ListResult = Paged<ProductCard> & { facets: Facets };

export type WhereTerm =
  | { kind: "base" }
  | { kind: "category_in"; ids: number[] }
  | { kind: "brand_in"; ids: number[] }
  | { kind: "collection_in"; ids: number[] }
  | { kind: "sale" }
  | { kind: "new"; sinceIso: string }
  | { kind: "gift_collections" }
  | { kind: "ids"; ids: number[] }
  | { kind: "price_between"; min: number | null; max: number | null }
  | { kind: "avail"; keys: ("in" | "sale" | "ready")[] }
  | { kind: "color_in"; values: string[] }
  | { kind: "attr"; key: string; values: string[] };

export type ListPlan = {
  scope: ProductScope;
  where: WhereTerm[];
  orderBy: readonly OrderByTerm[];
  sort: SortKey;
  limit: number;
  offset: number;
  page: number;
  needsSold90d: boolean;
  facetScopeKey: string;
  filtered: boolean;
};

/** rules: "ids → explicit ids in the given order (compare, wishlist), max 60". */
const MAX_SCOPE_IDS = 60;

const DAY_MS = 86_400_000;

const isMoney = (n: number | undefined): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

// EDGE CASE: page 0 / negative / NaN → 1. "integers only": a fractional page floors to the page it
// sits inside. Infinity is not finite, so it degrades to 1 instead of overflowing the offset.
const clampPage = (page: number | undefined): number =>
  typeof page === "number" && Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;

// DECISION: the dedupe / trim / sort / cap of the token lists, the attribute-key filter and the
// avail enum filter are NOT reimplemented here - url/plp-state.normalizePlpState is the function
// plpUrl and parsePlpState already agree on, so a plan and the URL it came from can never disagree
// about what "one state" is. This function adds only what the contract asks for on top: the price
// pair is SWAPPED (the URL layer drops an inverted pair), and sort/page are RESOLVED to their
// defaults instead of being omitted, because "clamp page ≥ 1" and "unknown sort → recommended"
// describe a value, not an absence. `density` is carried through untouched (it is not a filter).
export function normalizeState(state: PlpState): PlpState {
  const draft: PlpState = { ...state };
  delete draft.priceMin;
  delete draft.priceMax;
  const min = isMoney(state.priceMin) ? state.priceMin : null;
  const max = isMoney(state.priceMax) ? state.priceMax : null;
  if (min !== null && max !== null && min > max) {
    draft.priceMin = max;
    draft.priceMax = min;
  } else {
    if (min !== null) draft.priceMin = min;
    if (max !== null) draft.priceMax = max;
  }

  const out = normalizePlpState(draft);
  out.sort = isSortKey(state.sort) ? state.sort : DEFAULT_SORT;
  // MAX_PAGE is deliberately NOT applied here: planQuery must still see page 201 to answer NOT_FOUND.
  out.page = clampPage(state.page);
  return out;
}

/** `state` must already be normalized. */
const isFilteredState = (state: PlpState): boolean =>
  activeFilterCount(state) > 0 || (state.sort ?? DEFAULT_SORT) !== DEFAULT_SORT;

export function isFiltered(state: PlpState): boolean {
  return isFilteredState(normalizeState(state));
}

/** The ids a `Db` round trip resolved for a plan that planQuery could only sketch (see buildPlan). */
type ScopeResolution = {
  categoryIds?: readonly number[];
  brandIds?: readonly number[];
  collectionIds?: readonly number[];
};

const NO_RESOLUTION: ScopeResolution = {};

const requireScopeId = (scope: ProductScope): number => {
  const id = scope.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    throw appError("VALIDATION", { details: { field: "scope.id", scope: scope.kind } });
  }
  return id;
};

const requireScopeIds = (scope: ProductScope): number[] => {
  const out: number[] = [];
  for (const id of scope.ids ?? []) {
    // DECISION: a non-integer / non-positive id is dropped rather than passed to the repository - 
    // the plan is the SQL shape and must never carry a value the schema cannot hold.
    if (Number.isSafeInteger(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  if (out.length === 0) {
    throw appError("VALIDATION", { details: { field: "scope.ids", scope: scope.kind } });
  }
  // EDGE CASE: 61 entries → truncated to 60, documented, not thrown.
  return out.slice(0, MAX_SCOPE_IDS);
};

/** `slug` is kept on the plan's scope because facetScopeKey keys a collection on it. */
const withSlug = (scope: ProductScope, from: ProductScope): ProductScope =>
  typeof from.slug === "string" && from.slug !== "" ? { ...scope, slug: from.slug } : scope;

// DECISION: colour and attribute tokens are faNorm'd before they enter the plan because the column
// they are compared with is facets.attributeValueKey(...), which is built with faNorm too. The URL
// keeps the shopper's spelling; the plan carries the match key.
const matchTokens = (values: readonly string[]): string[] => {
  const out: string[] = [];
  for (const raw of values) {
    const v = faNorm(raw);
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
};

function buildPlan(q: ProductQuery, now: Date, resolution: ScopeResolution): ListPlan {
  const state = normalizeState(q);
  const page = state.page ?? 1;
  // rules: crawler-trap guard. NOT_FOUND, not an empty page, so the URL never becomes indexable.
  if (page > MAX_PAGE) throw appError("NOT_FOUND", { details: { field: "page", page } });
  const sort: SortKey = state.sort ?? DEFAULT_SORT;

  // rules: the base term is ALWAYS first - draft/archived/hidden/link_only rows are never listed,
  // not even for the ids scope (compare and wishlist may hold a link_only product; it drops out of
  // the grid instead of leaking a row the storefront is not allowed to list).
  const where: WhereTerm[] = [{ kind: "base" }];
  let scope: ProductScope;

  switch (q.scope.kind) {
    case "all": {
      scope = { kind: "all" };
      break;
    }
    case "category": {
      const id = requireScopeId(q.scope);
      scope = withSlug({ kind: "category", id }, q.scope);
      // The pure plan carries the scope root; listProducts swaps in categories.descendantIds(db, id)
      // so the executed term is "the category and all of its descendants" (rules, the spec).
      where.push({ kind: "category_in", ids: [...(resolution.categoryIds ?? [id])] });
      break;
    }
    case "brand": {
      const id = requireScopeId(q.scope);
      scope = withSlug({ kind: "brand", id }, q.scope);
      where.push({ kind: "brand_in", ids: [id] });
      break;
    }
    case "collection": {
      const id = requireScopeId(q.scope);
      scope = withSlug({ kind: "collection", id }, q.scope);
      // Manual members ∪ rule members is one EXISTS inside products.repo.queryCards: the rule lives
      // in collections.rule_json, which only the repository reads (collections.ruleToPlan turns it
      // into this same WhereTerm vocabulary).
      where.push({ kind: "collection_in", ids: [id] });
      break;
    }
    case "sale": {
      scope = { kind: "sale" };
      where.push({ kind: "sale" });
      break;
    }
    case "new": {
      scope = { kind: "new" };
      // EDGE CASE: `now` is injected so the term is deterministic in tests.
      where.push({
        kind: "new",
        sinceIso: new Date(now.getTime() - NEW_SCOPE_DAYS * DAY_MS).toISOString(),
      });
      break;
    }
    case "gifts": {
      scope = { kind: "gifts" };
      where.push({ kind: "gift_collections" });
      break;
    }
    case "ids": {
      const ids = requireScopeIds(q.scope);
      scope = { kind: "ids", ids };
      where.push({ kind: "ids", ids: [...ids] });
      break;
    }
    default: {
      // Unreachable in TypeScript; a JavaScript caller with an unknown kind is a VALIDATION, never
      // a silently unscoped (= whole catalogue) query.
      const unknownKind: never = q.scope.kind;
      throw appError("VALIDATION", { details: { field: "scope.kind", value: String(unknownKind) } });
    }
  }

  // Filters follow the scope term in URL order (url/plp-state PLP_PARAM_ORDER) so one state always
  // produces one plan - the plan is a cache key as much as it is a query.
  if (state.brand !== undefined) {
    // DECISION: PlpState.brand carries SLUGS while brand_in carries ids, and planQuery is pure - so
    // the pure plan states the dimension with an empty id set and listProducts fills it in from
    // brands.listBrands. An unresolved slug therefore matches NOTHING (fail closed); it can never
    // widen the result set. Same for `collection` below.
    where.push({ kind: "brand_in", ids: [...(resolution.brandIds ?? [])] });
  }
  if (state.collection !== undefined) {
    where.push({ kind: "collection_in", ids: [...(resolution.collectionIds ?? [])] });
  }
  if (state.color !== undefined) {
    where.push({ kind: "color_in", values: matchTokens(state.color) });
  }
  if (state.priceMin !== undefined || state.priceMax !== undefined) {
    where.push({ kind: "price_between", min: state.priceMin ?? null, max: state.priceMax ?? null });
  }
  if (state.avail !== undefined) {
    where.push({ kind: "avail", keys: [...state.avail] });
  }
  for (const key of Object.keys(state.attr ?? {}).sort()) {
    const values = matchTokens(state.attr?.[key] ?? []);
    // EDGE CASE: an empty group is dropped (normalizePlpState already dropped the "" keys).
    if (values.length > 0) where.push({ kind: "attr", key, values });
  }

  return {
    scope,
    where,
    orderBy: orderByPlan(sort),
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    page,
    needsSold90d: sort === "bestselling",
    facetScopeKey: facetScopeKey(scope),
    filtered: isFilteredState(state),
  };
}

export function planQuery(q: ProductQuery, now: Date = new Date()): ListPlan {
  return buildPlan(q, now, NO_RESOLUTION);
}

const idsBySlug = (
  rows: readonly { id: number; slug: string }[],
  slugs: readonly string[],
): number[] => {
  const bySlug = new Map<string, number>();
  for (const row of rows) bySlug.set(row.slug.toLowerCase(), row.id);
  const out: number[] = [];
  for (const slug of slugs) {
    const id = bySlug.get(slug.toLowerCase());
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
};

/** The one round trip that turns the sketched ids of a pure plan into executable ones. */
async function resolveScope(db: Db, scope: ProductScope, state: PlpState): Promise<ScopeResolution> {
  const categoryId = scope.kind === "category" ? scope.id : undefined;
  const wantsBrands = (state.brand?.length ?? 0) > 0;
  const wantsCollections = (state.collection?.length ?? 0) > 0;
  if (categoryId === undefined && !wantsBrands && !wantsCollections) return NO_RESOLUTION;

  const [descendants, brands, collections] = await Promise.all([
    categoryId === undefined ? Promise.resolve(null) : descendantIds(db, categoryId),
    // DECISION: one list per dimension (both are small, cached, tag-invalidated reads) instead of a
    // lookup per token - never N+1 (products.repo rules).
    wantsBrands ? listBrands(db) : Promise.resolve(null),
    wantsCollections ? listCollections(db) : Promise.resolve(null),
  ]);

  const out: ScopeResolution = {};
  if (descendants !== null && descendants.length > 0) out.categoryIds = descendants;
  if (brands !== null) out.brandIds = idsBySlug(brands, state.brand ?? []);
  if (collections !== null) out.collectionIds = idsBySlug(collections, state.collection ?? []);
  return out;
}

/**
 * EDGE CASE: "result page past the end → items [], total unchanged". `queryCards` reads the total
 * from `count(*) over ()`, a WINDOW over the returned rows - an empty page carries no row to read
 * it from, so it answers 0. Re-running the same plan at offset 0 with limit 1 recovers the real
 * total in one extra round trip, and only in this rare case (a crawler or a stale «نمایش بیشتر»);
 * page 1 of an empty result set is genuinely 0 and never pays for it.
 */
async function totalPastTheEnd(db: Db, plan: ListPlan): Promise<number> {
  if (plan.page === 1) return 0;
  const probe = await queryCards(db, { ...plan, limit: 1, offset: 0, page: 1 });
  return probe.total;
}

export async function listProducts(db: Db, q: ProductQuery): Promise<ListResult> {
  // One clock for the plan and for the cards, so a `new` scope and a «جدید» badge cannot disagree.
  const now = new Date();
  const plan = planQuery(q, now);
  const state = normalizeState(q);

  // rules: category → the category and all of its descendants; brand/collection filters carry SLUGS
  // in the URL and ids in the plan, so one round trip resolves them and the plan is rebuilt with the
  // executable id sets (an unresolved slug stays an empty set = fail closed, never a wider result).
  const resolution = await resolveScope(db, plan.scope, state);
  const executable = resolution === NO_RESOLUTION ? plan : buildPlan(q, now, resolution);

  const [rows, scopeFacets] = await Promise.all([
    queryCards(db, executable),
    // Facets are computed for the SCOPE only and cached by the caller; the state only prunes.
    computeFacets(db, plan.scope),
  ]);

  // rules: "ids → explicit ids in the given order (compare, wishlist)". `queryCards` executes the
  // plan's ORDER BY verbatim (its own DECISION), so restoring the caller's order is this function's
  // job - the WhereTerm's comment says exactly that: "order preserved by the caller".
  const ordered =
    executable.scope.kind === "ids" && executable.scope.ids !== undefined
      ? [...rows.ids].sort(
          (a, b) => (executable.scope.ids ?? []).indexOf(a) - (executable.scope.ids ?? []).indexOf(b),
        )
      : rows.ids;

  // A page past the last one skips the hydration round trip entirely.
  const sources = ordered.length === 0 ? [] : await findCardSources(db, ordered);
  const total = rows.ids.length === 0 ? await totalPastTheEnd(db, executable) : rows.total;

  return {
    items: sources.map((source) => toProductCard(source, now)),
    total,
    page: plan.page,
    pageSize: plan.limit,
    facets: pruneFacets(scopeFacets, state),
  };
}
