import type { Db } from "@namilux/db";
import { type PlpState, normalizePlpState, withoutFilter } from "../url";
import type { ProductQuery } from "./list";
// DECISION (M0 step 3 / M1 integration): `AttributeKind` is declared once in ../constants and the
// three facet shapes of the contract (FacetOption, AttributeFacet, Facets) once in ../types - 
// src/index.ts re-exports both `./types` and `./catalog`, so a second declaration here would be a
// TS2308 duplicate export. They are re-exported below so the contract's export list still holds.
// `ImageRef` is therefore no longer imported from ./media directly: ../types carries it inside
// `FacetOption.swatch` (dependency list's `./media (ImageRef)` is satisfied transitively).
import type { AttributeKind } from "../constants";
import type { AttributeFacet, FacetOption, Facets } from "../types";
// DECISION: `./products.repo` is added to dependency list - the contract's `computeFacets(db, …)` is a DB
// function, and the spec keeps SQL inside `*/repo.ts`, so the one grouped statement lives in
// products.repo.ts `queryFacetSources` and this module stays pure assembly over its rows.
import { type FacetSources, queryFacetSources } from "./products.repo";
import { faNorm } from "../persian";

export type { AttributeKind, AttributeFacet, FacetOption, Facets };

export type ActiveChip = {
  group: "brand" | "collection" | "color" | "price" | "avail" | "attr";
  key?: string;
  value: string;
  label: string;
  removeState: PlpState;
};

// DECISION: kept as the literal the contract prints rather than an alias of ../constants
// AVAIL_FILTERS, so this module owns no shared mutable array; `facets.test.ts` asserts the two
// never diverge.
export const AVAIL_KEYS = ["in", "sale", "ready"] as const;

/** The three plain multi-value groups, in URL order (url/plp-state PLP_PARAM_ORDER). */
const LIST_GROUPS = ["brand", "collection", "color"] as const;

const labelFor = (options: readonly FacetOption[], value: string): string =>
  // EDGE CASE: a token that is not in the facets (stale URL) still gets a chip, labelled with the
  // raw token, so the shopper can always remove it.
  options.find((o) => o.value === value)?.label ?? value;

/** A scope with nothing to filter by: empty groups, no price range, zero counts. Fresh per call. */
const emptyFacets = (total: number): Facets => ({
  brand: [],
  collection: [],
  color: [],
  price: { min: 0, max: 0 },
  avail: { in: 0, sale: 0, ready: 0 },
  attrs: [],
  total,
});

// DECISION: category and brand key on the numeric id (the contract's own examples "category:12",
// "brand:24"), collection on the slug ("collection:coffee"); each falls back to the other
// identifier so a half-resolved scope can never share a cache entry with a resolved one. "ids"
// is not in the contract's list - it gets the constant "ids" because computeFacets short-circuits
// that scope without a query, so the key is never used to cache a DB result.
export function facetScopeKey(scope: ProductQuery["scope"]): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "category":
      return `category:${scope.id ?? scope.slug ?? ""}`;
    case "brand":
      return `brand:${scope.id ?? scope.slug ?? ""}`;
    case "collection":
      return `collection:${scope.slug ?? scope.id ?? ""}`;
    case "sale":
      return "sale";
    case "new":
      return "new";
    case "gifts":
      return "gifts";
    case "ids":
      return "ids";
  }
}

/** the spec: the colour swatches come from the attribute with this key, not from products.color_name. */
const COLOR_ATTRIBUTE_KEY = "color";

/** brands and collections are addressed in the URL by their slug and read by their name. */
const toOption = (r: { slug: string; name: string; count: number }): FacetOption => ({
  value: r.slug,
  label: r.name,
  count: r.count,
});

/**
 * One (attribute, value) row → a `FacetOption`. `hex`/`swatch` are optional properties, so a null
 * from the repo is omitted rather than written as null (tsconfig `exactOptionalPropertyTypes`).
 */
const toAttributeOption = (a: FacetSources["attributes"][number]): FacetOption => ({
  value: a.value,
  label: a.valueLabel,
  count: a.count,
  ...(a.hex === null ? {} : { hex: a.hex }),
  ...(a.swatch === null ? {} : { swatch: a.swatch }),
});

export async function computeFacets(db: Db, scope: ProductQuery["scope"]): Promise<Facets> {
  // EDGE CASE: compare/wishlist never show filters - no query at all, total = ids.length.
  if (scope.kind === "ids") return emptyFacets(scope.ids?.length ?? 0);

  const src = await queryFacetSources(db, scope);

  // The repo returns the (attribute, value) pairs already ordered by attributes.sort; "color" is
  // its own facet group (the spec swatches) and every other filterable key becomes an AttributeFacet.
  // Insertion order into `attrs` therefore preserves attributes.sort without a second sort.
  const color: FacetOption[] = [];
  const attrs: AttributeFacet[] = [];
  const byKey = new Map<string, AttributeFacet>();
  for (const a of src.attributes) {
    const option = toAttributeOption(a);
    if (a.key === COLOR_ATTRIBUTE_KEY) {
      color.push(option);
      continue;
    }
    const facet = byKey.get(a.key);
    if (facet) {
      facet.options.push(option);
      continue;
    }
    const created: AttributeFacet = {
      key: a.key,
      label: a.label,
      unit: a.unit,
      kind: a.kind,
      options: [option],
    };
    byKey.set(a.key, created);
    attrs.push(created);
  }

  return {
    brand: src.brands.map(toOption),
    collection: src.collections.map(toOption),
    color,
    price: { ...src.price },
    avail: { ...src.avail },
    attrs,
    total: src.total,
  };
}

export function pruneFacets(f: Facets, state: PlpState): Facets {
  // DECISION: the state is normalized first (same helper plpUrl/parsePlpState use), so "selected"
  // means exactly what the URL means - deduped, trimmed, over-long tokens dropped.
  const s = normalizePlpState(state);
  const keep =
    (selected: readonly string[] | undefined) =>
    (o: FacetOption): boolean =>
      o.count > 0 || (selected?.includes(o.value) ?? false);

  return {
    brand: f.brand.filter(keep(s.brand)),
    collection: f.collection.filter(keep(s.collection)),
    color: f.color.filter(keep(s.color)),
    price: { ...f.price },
    avail: { ...f.avail },
    // DECISION: an attribute facet whose every option was pruned is dropped too - an empty
    // accordion row is noise and the group itself can never be "selected".
    attrs: f.attrs
      .map((a): AttributeFacet => ({ ...a, options: a.options.filter(keep(s.attr?.[a.key])) }))
      .filter((a) => a.options.length > 0),
    // `total` is the scope size; pruning options never changes how many products the scope holds.
    total: f.total,
  };
}

export function activeFilterChips(state: PlpState, facets: Facets): ActiveChip[] {
  // Normalizing first is what makes "in URL order" true: normalizePlpState applies the same
  // dedupe + collation that plpUrl serializes with.
  const s = normalizePlpState(state);
  const chips: ActiveChip[] = [];

  for (const group of LIST_GROUPS) {
    for (const value of s[group] ?? []) {
      chips.push({
        group,
        value,
        label: labelFor(facets[group], value),
        // `withoutFilter` drops the token, deletes the key when it was the last one, and resets
        // `page` - exactly the contract's `removeState`.
        removeState: withoutFilter(s, group, value),
      });
    }
  }

  if (s.priceMin !== undefined || s.priceMax !== undefined) {
    chips.push({
      group: "price",
      // DECISION: the chip value is the URL token plpUrl emits for `price=` ("min-max", open ends
      // allowed), so a chip is always addressable by what the query string contains.
      value: `${s.priceMin ?? ""}-${s.priceMax ?? ""}`,
      // The UI formats «از … تا … تومان» from facets.price / the state; no copy lives in core.
      label: "",
      removeState: withoutFilter(s, "priceMin"),
    });
  }

  for (const key of s.avail ?? []) {
    chips.push({
      group: "avail",
      value: key,
      label: `plp.avail.${key}`,
      removeState: withoutFilter(s, "avail", key),
    });
  }

  for (const key of Object.keys(s.attr ?? {}).sort()) {
    // EDGE CASE: a key that is not a filterable attribute is ignored, never thrown.
    const facet = facets.attrs.find((a) => a.key === key);
    if (!facet) continue;
    for (const value of s.attr?.[key] ?? []) {
      chips.push({
        group: "attr",
        key,
        value,
        label: `${facet.label}: ${labelFor(facet.options, value)}`,
        // url/plp-state addresses one keyed token as "<attrKey>:<attrValue>".
        removeState: withoutFilter(s, "attr", `${key}:${value}`),
      });
    }
  }

  return chips;
}

/** Values a legacy `value_text` may carry for a boolean attribute (compared after faNorm). */
const BOOL_TRUE_TEXT = new Set(["1", "true", "yes", "on"]);

export function attributeValueKey(
  kind: AttributeKind,
  valueText: string | null,
  valueNum: number | null,
): string {
  switch (kind) {
    case "text":
    case "color":
      return faNorm(valueText ?? "");
    case "number":
      // DECISION: the contract says `String(valueNum)`; a missing/!finite number returns "" instead
      // of the token "null"/"NaN", which would become a filterable URL token that matches nothing.
      return valueNum == null || !Number.isFinite(valueNum) ? "" : String(valueNum);
    case "bool": {
      // DECISION: the spec stores a bool in `value_num`; `value_text` is only consulted when the
      // numeric column is empty (legacy rows), and only an explicit truthy word counts.
      const truthy = valueNum == null ? BOOL_TRUE_TEXT.has(faNorm(valueText ?? "")) : valueNum !== 0;
      return truthy ? "1" : "0";
    }
  }
}
