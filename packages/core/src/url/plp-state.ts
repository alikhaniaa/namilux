import { encSeg, ensureTrailingSlash } from "./encode";
import { AVAIL_FILTERS, PLP_DENSITIES, PLP_MAX_PAGE, SORT_KEYS } from "../constants";
import type { AvailFilter, PlpDensity, SortKey } from "../constants";
import { enDigits } from "../persian/format";
import { stripControl } from "../persian/normalize";

export type { SortKey };

export type PlpState = {
  brand?: string[];
  collection?: string[];
  color?: string[];
  priceMin?: number;
  priceMax?: number;
  avail?: AvailFilter[];
  attr?: Record<string, string[]>;
  sort?: SortKey;
  page?: number;
  density?: PlpDensity;
};

export const PLP_DEFAULTS = { sort: "recommended", page: 1, density: 3 } as const satisfies PlpState;

export const PLP_PARAM_ORDER = ["brand", "collection", "color", "price", "avail", "attr", "sort", "page", "density"] as const;
export const PLP_MAX_VALUES_PER_FACET = 20;
export const PLP_MAX_VALUE_LEN = 64;
export const PLP_ATTR_KEY_RE = /^[a-z0-9_]{1,32}$/;

/** The three plain multi-value facets (attr is keyed, avail is an enum). */
const LIST_FACETS = ["brand", "collection", "color"] as const;
type ListFacet = (typeof LIST_FACETS)[number];

const FA_COLLATOR = new Intl.Collator("fa");

const isAscii = (s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 0x7f) return false;
  }
  return true;
};

// DECISION: "sorted with Intl.Collator('fa') for Persian and plain for Latin" is implemented as one
// total order: pure-ASCII values compare by code point, non-ASCII values compare with the fa
// collator, and ASCII sorts before non-ASCII. A single collator for everything, or a per-pair
// choice, would not be transitive/stable across mixed lists - and an unstable order would mint two
// URLs for one state, which is exactly what this module exists to prevent.
const compareValues = (a: string, b: string): number => {
  const aAscii = isAscii(a);
  const bAscii = isAscii(b);
  if (aAscii && bAscii) return a < b ? -1 : a > b ? 1 : 0;
  if (aAscii !== bAscii) return aAscii ? -1 : 1;
  return FA_COLLATOR.compare(a, b);
};

const cleanValue = (raw: string): string | null => {
  const v = stripControl(raw).trim();
  // DECISION: an over-long value is DROPPED, not truncated - a truncated value would silently match
  // a different facet term.
  if (v === "" || v.length > PLP_MAX_VALUE_LEN) return null;
  return v;
};

const normalizeList = (values: readonly string[] | undefined): string[] | null => {
  if (!values || values.length === 0) return null;
  const out: string[] = [];
  for (const raw of values) {
    const v = cleanValue(raw);
    if (v !== null && !out.includes(v)) out.push(v);
  }
  if (out.length === 0) return null;
  out.sort(compareValues);
  return out.slice(0, PLP_MAX_VALUES_PER_FACET);
};

const normalizeMoney = (n: number | undefined): number | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;

/** dedupes and orders by the AVAIL_FILTERS enum order (the order the spec prints: in,sale,ready). */
const normalizeAvail = (avail: readonly AvailFilter[] | undefined): AvailFilter[] | null => {
  if (!avail || avail.length === 0) return null;
  const out = AVAIL_FILTERS.filter((f) => avail.includes(f));
  return out.length === 0 ? null : [...out];
};

const normalizeAttr = (attr: PlpState["attr"]): Record<string, string[]> | null => {
  if (!attr) return null;
  const out: Record<string, string[]> = {};
  for (const key of Object.keys(attr).sort()) {
    if (!PLP_ATTR_KEY_RE.test(key)) continue;
    const list = normalizeList(attr[key]);
    if (list) out[key] = list;
  }
  return Object.keys(out).length === 0 ? null : out;
};

const normalizeSort = (sort: string | undefined): SortKey | null =>
  sort !== undefined && sort !== PLP_DEFAULTS.sort && (SORT_KEYS as readonly string[]).includes(sort)
    ? (sort as SortKey)
    : null;

const normalizePage = (page: number | undefined): number | null =>
  typeof page === "number" && Number.isInteger(page) && page > PLP_DEFAULTS.page && page <= PLP_MAX_PAGE ? page : null;

const normalizeDensity = (density: number | undefined): PlpDensity | null =>
  density !== undefined && density !== PLP_DEFAULTS.density && (PLP_DENSITIES as readonly number[]).includes(density)
    ? (density as PlpDensity)
    : null;

/**
 * The canonical form of a state: defaults dropped, values deduped/sorted/clamped, an inconsistent
 * price pair removed. `plpUrl` serializes exactly this, and `parsePlpState` returns exactly this,
 * which is what makes the round-trip RULE hold.
 * DECISION: exported although the spec does not list it - the rules section of this module refers to
 * `normalize(s)` by name, and callers (facets, canonical tags) need the same normalization.
 */
export function normalizePlpState(state: PlpState): PlpState {
  const out: PlpState = {};
  for (const facet of LIST_FACETS) {
    const list = normalizeList(state[facet]);
    if (list) out[facet] = list;
  }
  const min = normalizeMoney(state.priceMin);
  const max = normalizeMoney(state.priceMax);
  if (min === null || max === null || min <= max) {
    if (min !== null) out.priceMin = min;
    if (max !== null) out.priceMax = max;
  }
  const avail = normalizeAvail(state.avail);
  if (avail) out.avail = avail;
  const attr = normalizeAttr(state.attr);
  if (attr) out.attr = attr;
  const sort = normalizeSort(state.sort);
  if (sort) out.sort = sort;
  const page = normalizePage(state.page);
  if (page) out.page = page;
  const density = normalizeDensity(state.density);
  if (density) out.density = density;
  return out;
}

const joinValues = (values: readonly string[]): string => values.map(encSeg).join(",");

export function plpUrl(base: string, state: PlpState): string {
  const s = normalizePlpState(state);
  const params: string[] = [];
  for (const facet of LIST_FACETS) {
    const list = s[facet];
    if (list) params.push(`${facet}=${joinValues(list)}`);
  }
  if (s.priceMin !== undefined || s.priceMax !== undefined) {
    params.push(`price=${s.priceMin ?? ""}-${s.priceMax ?? ""}`);
  }
  if (s.avail) params.push(`avail=${s.avail.join(",")}`);
  if (s.attr) {
    for (const key of Object.keys(s.attr).sort()) {
      const values = s.attr[key];
      if (values) params.push(`attr.${key}=${joinValues(values)}`);
    }
  }
  if (s.sort) params.push(`sort=${s.sort}`);
  if (s.page) params.push(`page=${s.page}`);
  if (s.density) params.push(`density=${s.density}`);
  // DECISION: `base` goes through ensureTrailingSlash so a hand-built base can never break the
  // the spec trailing-slash contract; a base that already ends in "/" is untouched.
  const b = ensureTrailingSlash(base);
  return params.length === 0 ? b : `${b}?${params.join("&")}`;
}

const INT_RE = /^\d{1,15}$/;

/** `null` = open end, `undefined` = malformed (drops the whole price filter). */
const parsePricePart = (raw: string | undefined): number | null | undefined => {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  if (!INT_RE.test(s)) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isSafeInteger(n) ? n : undefined;
};

const foldNumber = (raw: string): string => enDigits(stripControl(raw)).trim();

// DECISION (also logged in the spec): the "," separator is split AFTER
// URLSearchParams has decoded the value, because the function's signature receives an already
// decoded URLSearchParams. A literal comma inside a facet value therefore does not survive the
// round-trip even though plpUrl encodes it as %2c. Facet values are slugs / enum labels / colour
// names, none of which contain a comma.
export function parsePlpState(searchParams: URLSearchParams): PlpState {
  try {
    const lists: Record<ListFacet, string[]> = { brand: [], collection: [], color: [] };
    const availRaw: AvailFilter[] = [];
    const attrRaw: Record<string, string[]> = {};
    let priceRaw: string | undefined;
    let sortRaw: string | undefined;
    let pageRaw: string | undefined;
    let densityRaw: string | undefined;

    for (const [rawKey, rawValue] of searchParams.entries()) {
      const key = rawKey.trim();
      const values = rawValue.split(",");
      if (key === "brand" || key === "collection" || key === "color") {
        lists[key].push(...values);
        continue;
      }
      if (key === "avail") {
        for (const v of values) {
          const c = cleanValue(v);
          if (c !== null && (AVAIL_FILTERS as readonly string[]).includes(c)) availRaw.push(c as AvailFilter);
        }
        continue;
      }
      if (key === "price") {
        priceRaw = rawValue;
        continue;
      }
      if (key === "sort") {
        sortRaw = rawValue;
        continue;
      }
      if (key === "page") {
        pageRaw = rawValue;
        continue;
      }
      if (key === "density") {
        densityRaw = rawValue;
        continue;
      }
      if (key.startsWith("attr.")) {
        const attrKey = key.slice("attr.".length);
        if (!PLP_ATTR_KEY_RE.test(attrKey)) continue;
        const bucket = attrRaw[attrKey] ?? [];
        bucket.push(...values);
        attrRaw[attrKey] = bucket;
      }
      // every other key is ignored
    }

    const draft: PlpState = {};
    for (const facet of LIST_FACETS) {
      if (lists[facet].length > 0) draft[facet] = lists[facet];
    }
    if (availRaw.length > 0) draft.avail = availRaw;
    if (Object.keys(attrRaw).length > 0) draft.attr = attrRaw;

    if (priceRaw !== undefined) {
      const parts = foldNumber(priceRaw).split("-");
      if (parts.length === 2) {
        const min = parsePricePart(parts[0]);
        const max = parsePricePart(parts[1]);
        if (min !== undefined && max !== undefined) {
          if (min !== null) draft.priceMin = min;
          if (max !== null) draft.priceMax = max;
        }
      }
    }
    if (sortRaw !== undefined) {
      const sort = normalizeSort(stripControl(sortRaw).trim());
      if (sort) draft.sort = sort;
    }
    if (pageRaw !== undefined) {
      const page = foldNumber(pageRaw);
      if (/^\d{1,7}$/.test(page)) draft.page = Number.parseInt(page, 10);
    }
    if (densityRaw !== undefined) {
      const raw = foldNumber(densityRaw);
      const density = /^\d{1,2}$/.test(raw) ? normalizeDensity(Number.parseInt(raw, 10)) : null;
      if (density) draft.density = density;
    }

    return normalizePlpState(draft);
  } catch {
    // "Never throws" - a hostile/exotic URLSearchParams degrades to the default state.
    return {};
  }
}

export function isDefaultPlpState(state: PlpState): boolean {
  const s = normalizePlpState(state);
  return activeFilterCount(s) === 0 && s.sort === undefined && s.page === undefined;
}

export function canonicalPlpUrl(base: string, state: PlpState): string {
  const b = ensureTrailingSlash(base);
  const page = normalizePage(state.page);
  return page === null ? b : `${b}?page=${page}`;
}

export function isIndexablePlpState(state: PlpState): boolean {
  const s = normalizePlpState(state);
  return activeFilterCount(s) === 0 && s.sort === undefined;
}

export function activeFilterCount(state: PlpState): number {
  const s = normalizePlpState(state);
  let count = 0;
  for (const facet of LIST_FACETS) count += s[facet]?.length ?? 0;
  count += s.avail?.length ?? 0;
  for (const values of Object.values(s.attr ?? {})) count += values.length;
  if (s.priceMin !== undefined || s.priceMax !== undefined) count += 1;
  return count;
}

const dropValue = (values: readonly string[] | undefined, value: string): string[] | null => {
  const rest = (values ?? []).filter((v) => v !== value);
  return rest.length === 0 ? null : rest;
};

// DECISION: `page` is dropped for every key, not only for filter keys - the rules say "changing any
// filter resets page" and a uniform reset can never leave a caller on an out-of-range page.
// DECISION: for key "attr" the optional `value` is read as "<attrKey>:<attrValue>" (one chip) and,
// when it carries no ":", as the attribute key itself (the whole group). The signature has no other
// way to address a keyed facet.
export function withoutFilter(state: PlpState, key: keyof PlpState, value?: string): PlpState {
  const next = normalizePlpState(state);
  delete next.page;
  switch (key) {
    case "brand":
    case "collection":
    case "color": {
      if (value === undefined) delete next[key];
      else {
        const rest = dropValue(next[key], value);
        if (rest) next[key] = rest;
        else delete next[key];
      }
      break;
    }
    case "avail": {
      if (value === undefined) delete next.avail;
      else {
        const rest = (next.avail ?? []).filter((v) => v !== value);
        if (rest.length > 0) next.avail = rest;
        else delete next.avail;
      }
      break;
    }
    case "priceMin":
    case "priceMax": {
      delete next.priceMin;
      delete next.priceMax;
      break;
    }
    case "attr": {
      if (value === undefined) {
        delete next.attr;
        break;
      }
      const attr: Record<string, string[]> = { ...(next.attr ?? {}) };
      const sep = value.indexOf(":");
      if (sep === -1) {
        delete attr[value];
      } else {
        const attrKey = value.slice(0, sep);
        const rest = dropValue(attr[attrKey], value.slice(sep + 1));
        if (rest) attr[attrKey] = rest;
        else delete attr[attrKey];
      }
      if (Object.keys(attr).length > 0) next.attr = attr;
      else delete next.attr;
      break;
    }
    case "sort": {
      delete next.sort;
      break;
    }
    case "density": {
      delete next.density;
      break;
    }
    case "page":
      break;
  }
  return next;
}
