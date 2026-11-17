import { faNorm } from "@namilux/core/client";
import type { NavBrand, NavCollection, SearchIndexEntry } from "@namilux/core/client";

/** The overlay shows twelve products; `/search/` passes Infinity for "all". */
export const OVERLAY_PRODUCT_LIMIT = 12;

// The four tiers of the header, in order. A product never scores two tiers: the first that matches wins.
const SCORE_PREFIX = 10;
const SCORE_WORD_START = 6;
const SCORE_BRAND_MODEL = 5;
const SCORE_FUZZY = 2;
const BOOST_IN_STOCK = 1;
const BOOST_PRICED = 0.5;
const FUZZY_MIN_OVERLAP = 0.6;

type Normalized = {
  entry: SearchIndexEntry;
  dn: string;
  b: string;
  m: string;
  /** slug with dashes as spaces - the Latin words (brand, model, keywords) of the URL. */
  sl: string;
  /** dn + brand + model, normalized and space-collapsed - the fuzzy/multi-token haystack. */
  hay: string;
};

// rules: "memoize normalized fields once per index load". The index array is the identity: the hook
// hands the same array to every consumer for the lifetime of the page, and a reloaded index is a new
// array, so a WeakMap both shares the work and lets the old normalization be collected.
const NORMALIZED: WeakMap<readonly SearchIndexEntry[], Normalized[]> = new WeakMap();

function normalizedEntries(index: readonly SearchIndexEntry[]): Normalized[] {
  const cached = NORMALIZED.get(index);
  if (cached !== undefined) return cached;
  const built = index.map((entry) => {
    const dn = faNorm(entry.dn);
    const b = faNorm(entry.b);
    const m = faNorm(entry.m ?? "");
    // DECISION (M8 browser check): the slug carries the Latin words shoppers actually type ("smeg",
    // "dyson hs08") that the Persian display name and brand never contain; it joins the haystack and
    // gets its own brand/model-tier check so a Latin query lists products, not only the brand chip.
    const sl = faNorm(entry.slug.replace(/-/g, " "));
    return { entry, dn, b, m, sl, hay: `${dn} ${b} ${m} ${sl}`.replace(/\s+/g, " ").trim() };
  });
  NORMALIZED.set(index, built);
  return built;
}

/** True when `needle` starts a word of `text` (both already normalized: words are space-separated). */
function hasWordStart(text: string, needle: string): boolean {
  if (needle === "") return false;
  let at = text.indexOf(needle);
  while (at !== -1) {
    if (at === 0 || text[at - 1] === " ") return true;
    at = text.indexOf(needle, at + 1);
  }
  return false;
}

// DECISION: "bigram overlap" is measured against the QUERY's bigrams, not Dice's coefficient. A
// two-word query against a ten-word product name would score ~0.2 under Dice and could never reach
// the .6 the header asks for, so the tier would be dead code; the query-relative reading is the one
// that makes «کتری برغی» find «کتری برقی» as the TESTS require.
function bigramOverlap(q: string, hay: string): number {
  if (q.length < 2 || hay.length < 2) return 0;
  let total = 0;
  let hits = 0;
  for (let i = 0; i + 1 < q.length; i += 1) {
    total += 1;
    if (hay.includes(q.slice(i, i + 2))) hits += 1;
  }
  return total === 0 ? 0 : hits / total;
}

function scoreEntry(n: Normalized, nq: string, tokens: string[]): number {
  let base = 0;
  if (n.dn.startsWith(nq)) base = SCORE_PREFIX;
  else if (hasWordStart(n.dn, nq)) base = SCORE_WORD_START;
  else if ((n.b !== "" && n.b.includes(nq)) || (n.m !== "" && n.m.includes(nq))) base = SCORE_BRAND_MODEL;
  else if (n.sl !== "" && hasWordStart(n.sl, nq)) base = SCORE_BRAND_MODEL;
  // DECISION: a multi-word query is also tried token-by-token over dn+brand+model, because the
  // fields the reader sees as one line ("کتری برقی اسمگ") live in three separate index keys - the
  // header's tiers alone would score that natural query 0. All tokens must hit (AND), so the tier
  // stays as selective as the single-string one; it reuses the same two scores.
  else if (tokens.length > 1 && tokens.every((tk) => hasWordStart(n.hay, tk))) base = SCORE_WORD_START;
  else if (tokens.length > 1 && tokens.every((tk) => n.hay.includes(tk))) base = SCORE_BRAND_MODEL;
  else if (bigramOverlap(nq, n.hay) >= FUZZY_MIN_OVERLAP) base = SCORE_FUZZY;
  if (base === 0) return 0;
  if (n.entry.s) base += BOOST_IN_STOCK;
  if (n.entry.p > 0) base += BOOST_PRICED;
  return base;
}

/** Brands and collections match on their names only; the tiers mirror the product ones. */
function nameScore(names: string[], nq: string): number {
  let best = 0;
  for (const raw of names) {
    const name = faNorm(raw);
    if (name === "") continue;
    let s = 0;
    if (name.startsWith(nq)) s = SCORE_PREFIX;
    else if (hasWordStart(name, nq)) s = SCORE_WORD_START;
    else if (name.includes(nq)) s = SCORE_BRAND_MODEL;
    else if (bigramOverlap(nq, name) >= FUZZY_MIN_OVERLAP) s = SCORE_FUZZY;
    if (s > best) best = s;
  }
  return best;
}

function resolveLimit(limit: number | undefined, matched: number): number {
  if (limit === undefined) return OVERLAY_PRODUCT_LIMIT;
  // Infinity is how `/search/` asks for "all"; a negative or NaN limit shows nothing rather than
  // silently falling back to a number the caller did not ask for.
  if (!Number.isFinite(limit)) return limit > 0 ? matched : 0;
  return Math.max(0, Math.floor(limit));
}

export function search(
  index: SearchIndexEntry[],
  q: string,
  opts?: { limit?: number; brands?: NavBrand[]; collections?: NavCollection[] },
): { brands: NavBrand[]; collections: NavCollection[]; products: SearchIndexEntry[]; total: number; ms: number } {
  const started = performance.now();
  const nq = faNorm(q);
  if (nq === "") return { brands: [], collections: [], products: [], total: 0, ms: performance.now() - started };

  const tokens = nq.split(" ").filter((tk) => tk !== "");

  const scoredBrands = (opts?.brands ?? [])
    .map((brand) => ({ brand, score: nameScore([brand.name, brand.nameEn, brand.slug], nq) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.brand.count - a.brand.count)
    .map((x) => x.brand);

  const scoredCollections = (opts?.collections ?? [])
    .map((collection) => ({ collection, score: nameScore([collection.name, collection.slug], nq) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.collection.count - a.collection.count)
    .map((x) => x.collection);

  const matched: { entry: SearchIndexEntry; score: number }[] = [];
  for (const n of normalizedEntries(index)) {
    const score = scoreEntry(n, nq, tokens);
    if (score > 0) matched.push({ entry: n.entry, score });
  }
  // Ties by price desc (header). Array.prototype.sort is stable, so equal price keeps index order - 
  // and the index arrives in "recommended" order from the builder.
  matched.sort((a, b) => b.score - a.score || b.entry.p - a.entry.p);

  const take = resolveLimit(opts?.limit, matched.length);
  return {
    brands: scoredBrands,
    collections: scoredCollections,
    products: matched.slice(0, take).map((x) => x.entry),
    // DECISION: `total` counts PRODUCTS only - it is what «مشاهدهٔ همهٔ n نتیجه» links to, and
    // `/search/?q=` lists products; counting brand and collection rows would make the promise wrong.
    total: matched.length,
    ms: performance.now() - started,
  };
}

// ---------------------------------------------------------------- highlight
// The runs must be cut out of the ORIGINAL text (it is what the reader sees), while the match is
// found in the normalized one. faNorm deletes characters (diacritics, invisibles) and collapses
// whitespace, so the offsets do not line up - this local normalizer produces the same string plus a
// map from each normalized character back to the original index. The test asserts the parity
// (`normalizeWithMap(x).norm === faNorm(x)`) so the two can never drift.
// Invisible characters are written as \u escapes on purpose (same reason as the core normalizer):
// this table is a twin of packages/core/src/persian/normalize.ts and must stay reviewable.
const HL_ARABIC: Record<string, string> = { "ي": "ی", "ى": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه" };
/** harakat U+064B–U+0652, superscript alef U+0670, tatweel U+0640 */
const HL_DIACRITIC = /[\u064B-\u0652\u0670\u0640]/u;
/** LRM, RLM, soft hyphen */
const HL_INVISIBLE = /[\u200E\u200F\u00AD]/u;
/** ZWNJ, ZWJ - both become a single space, as in faNorm step 4 */
const HL_JOINER = /[\u200C\u200D]/u;
const HL_SPACE = /\s/u;
const FA_ZERO = 0x06f0;
const AR_ZERO = 0x0660;
const ASCII_ZERO = 0x30;

function foldDigit(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= FA_ZERO && code <= FA_ZERO + 9) return String.fromCharCode(ASCII_ZERO + code - FA_ZERO);
  if (code >= AR_ZERO && code <= AR_ZERO + 9) return String.fromCharCode(ASCII_ZERO + code - AR_ZERO);
  return ch;
}

export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const raw = text[i];
    if (raw === undefined) continue;
    if (HL_DIACRITIC.test(raw) || HL_INVISIBLE.test(raw)) continue;
    let ch = HL_ARABIC[raw] ?? raw;
    if (HL_JOINER.test(ch)) ch = " ";
    ch = foldDigit(ch);
    if (HL_SPACE.test(ch)) {
      // Leading whitespace is dropped and runs collapse: the space is only emitted once something
      // follows it, which is exactly `collapseSpaces` + `trim`.
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out.push(" ");
      map.push(i);
      pendingSpace = false;
    }
    // A lowercase form can be longer than one character (İ → i̇); every produced character points
    // back at the same original index, so the mapping stays total.
    for (const lower of ch.toLowerCase()) {
      out.push(lower);
      map.push(i);
    }
  }
  return { norm: out.join(""), map };
}

function occurrences(norm: string, map: number[], needle: string): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  let at = norm.indexOf(needle);
  while (at !== -1) {
    const from = map[at];
    const lastChar = map[at + needle.length - 1];
    if (from !== undefined && lastChar !== undefined) found.push({ from, to: lastChar + 1 });
    at = norm.indexOf(needle, at + needle.length);
  }
  return found;
}

export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  if (text === "") return [];
  const nq = faNorm(q);
  const tokens = nq.split(" ").filter((tk) => tk !== "");
  if (tokens.length === 0) return [{ text, hit: false }];

  const { norm, map } = normalizeWithMap(text);
  // DECISION: the whole query is tried first, so «چای ساز» marks «چای‌ساز» as ONE run instead of
  // two with the ZWNJ left unmarked between them; the per-token pass is the fallback for a query
  // whose words are apart in the name.
  let ranges = occurrences(norm, map, nq);
  if (ranges.length === 0) {
    for (const token of tokens) ranges = [...ranges, ...occurrences(norm, map, token)];
  }
  if (ranges.length === 0) return [{ text, hit: false }];

  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }

  const runs: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const { from, to } of merged) {
    if (from > cursor) runs.push({ text: text.slice(cursor, from), hit: false });
    runs.push({ text: text.slice(from, to), hit: true });
    cursor = to;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), hit: false });
  return runs;
}
