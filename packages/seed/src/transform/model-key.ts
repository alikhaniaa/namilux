import { faNorm } from "@namilux/core";
import { COLOR_TOKENS_FA, COLOR_TOKENS_EN } from "../extract/taxonomy.js";
import { BRAND_ALIASES } from "../extract/brands.js";

export const MODEL_CODE_RE = /\b([A-Z]{1,5})[\s-]?(\d{2,4})[\s-]?([A-Z]{0,4})\b/i;

export const MODEL_CODE_STOPLIST: readonly string[] = ["2X", "4K", "3D", "XXL", "XL", "USB", "LED", "BPA", "AC", "DC", "V9", "V8"];

/** Non-colour noise words removed from the fallback key (v2 §6.3 + observed names). */
export const KEY_NOISE_TOKENS: readonly string[] = ["رنگ", "مدل", "new", "نیوکالکشن", "نیو کالکشن", "اورجینال", "اصل"];

export type ModelGroup = { key: string; ids: number[]; primaryId: number; brandSlug: string | null };

// ---------------------------------------------------------------- internals
/** Global twin of MODEL_CODE_RE (the exported one stays non-global so `.test()` is stateless). */
const MODEL_CODE_RE_G = new RegExp(MODEL_CODE_RE.source, "gi");
/** Anchored twin - used to accept a SKU only when the WHOLE sku is a designator. */
const MODEL_CODE_RE_FULL = new RegExp(`^(?:${MODEL_CODE_RE.source.replace(/\\b/g, "")})$`, "i");
const STOPLIST = new Set(MODEL_CODE_STOPLIST.map((t) => t.toUpperCase()));
const SEPARATORS_RE = /[\s-]+/g;
const WORD_BOUNDARY_LEFT = "(?<![\\p{L}\\p{N}])";
const WORD_BOUNDARY_RIGHT = "(?![\\p{L}\\p{N}])";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A token list compiled to whole-word removal rules, longest first (rules: «سبز سرامیکی» before «سبز»). */
function removalRules(tokens: readonly string[]): { re: RegExp }[] {
  const normalized = [...new Set(tokens.map((t) => faNorm(t)).filter((t) => t !== ""))];
  normalized.sort((a, b) => b.length - a.length);
  return normalized.map((t) => ({ re: new RegExp(`${WORD_BOUNDARY_LEFT}${escapeRe(t)}${WORD_BOUNDARY_RIGHT}`, "gu") }));
}

const COLOR_RULES = removalRules([...COLOR_TOKENS_FA, ...COLOR_TOKENS_EN]);
const NOISE_RULES = removalRules(KEY_NOISE_TOKENS);

// DECISION: dependency list does not list ../extract/brands, but the §6.3 edge case requires the key
// "smeg klf03" for a name whose brand is written «اسمگ» - that mapping only exists in
// BRAND_ALIASES. brands.ts imports core + ./paths only, so there is no cycle. Challenge logged in
// the spec.
const BRAND_RULES: { token: string; slug: string }[] = Object.entries(BRAND_ALIASES)
  .map(([token, slug]) => ({ token: faNorm(token), slug }))
  .filter((r) => r.token !== "")
  .sort((a, b) => b.token.length - a.token.length);

/** First brand alias occurring in a normalized name, scanned longest-alias-first (v1 name fallback). */
function brandTokenFromName(normalizedName: string): string | null {
  let best: { slug: string; at: number } | null = null;
  for (const rule of BRAND_RULES) {
    const re = new RegExp(`${WORD_BOUNDARY_LEFT}${escapeRe(rule.token)}${WORD_BOUNDARY_RIGHT}`, "u");
    const at = normalizedName.search(re);
    if (at < 0) continue;
    // Earliest occurrence in the name wins; ties go to the longer alias (BRAND_RULES order).
    if (best === null || at < best.at) best = { slug: rule.slug, at };
  }
  return best === null ? null : best.slug;
}

function normalizeCode(raw: string): string {
  return raw.replace(SEPARATORS_RE, "").toUpperCase();
}

// ---------------------------------------------------------------- contract
export function extractModelCode(name: string, sku?: string | null): string | null {
  const rawSku = typeof sku === "string" ? sku.trim() : "";
  if (rawSku !== "") {
    const compact = normalizeCode(rawSku);
    if (MODEL_CODE_RE_FULL.test(rawSku) && !STOPLIST.has(compact)) return compact;
  }
  if (typeof name !== "string" || name === "") return null;
  MODEL_CODE_RE_G.lastIndex = 0;
  for (const match of name.matchAll(MODEL_CODE_RE_G)) {
    const code = normalizeCode(match[0]);
    if (STOPLIST.has(code)) continue;
    // The regex already requires ≥ 1 Latin letter + 2–4 digits, so "08" and "2024" never match.
    return code;
  }
  return null;
}

export function modelKey(name: string, sku?: string | null): string {
  const safeName = typeof name === "string" ? name : "";
  const normalized = faNorm(safeName);
  const code = extractModelCode(safeName, sku);
  if (code !== null) {
    // DECISION (header): the designator is the strongest grouping signal, so brand+code groups
    // colour variants whose Persian wording differs (KLF03 × 11).
    const brand = brandTokenFromName(normalized);
    return (brand === null ? code : `${brand} ${code}`).toLowerCase();
  }
  let key = stripColorTokens(normalized);
  for (const rule of NOISE_RULES) key = key.replace(rule.re, " ");
  key = key.replace(/\s+/g, " ").trim();
  return key === "" ? normalized : key;
}

export function stripColorTokens(normalizedName: string): string {
  if (typeof normalizedName !== "string" || normalizedName === "") return "";
  let out = normalizedName;
  for (const rule of COLOR_RULES) out = out.replace(rule.re, " ");
  return out.replace(/\s+/g, " ").trim();
}

export function groupByModelKey(
  items: { id: number; key: string; brandSlug: string | null; buyable: boolean; hasImage: boolean; price: number }[],
): ModelGroup[] {
  type Member = (typeof items)[number];
  const buckets = new Map<string, { key: string; brandSlug: string | null; members: Member[] }>();
  for (const item of items) {
    if (typeof item.key !== "string" || item.key === "") continue;
    // A key never spans brands (contract): the bucket id carries the brand.
    const bucketId = `${item.key}\u0000${item.brandSlug ?? ""}`;
    const bucket = buckets.get(bucketId) ?? { key: item.key, brandSlug: item.brandSlug, members: [] };
    bucket.members.push(item);
    buckets.set(bucketId, bucket);
  }

  const groups: ModelGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.members.length < 2) continue; // singletons keep model_id NULL
    const ranked = [...bucket.members].sort(
      (a, b) =>
        Number(b.buyable) - Number(a.buyable) ||
        Number(b.hasImage) - Number(a.hasImage) ||
        a.price - b.price ||
        a.id - b.id,
    );
    const primary = ranked[0];
    if (primary === undefined) continue;
    groups.push({
      key: bucket.key,
      ids: bucket.members.map((m) => m.id).sort((a, b) => a - b),
      primaryId: primary.id,
      brandSlug: bucket.brandSlug,
    });
  }
  // Deterministic output so re-seeding never re-shuffles groups (rules).
  groups.sort((a, b) => a.key.localeCompare(b.key) || (a.brandSlug ?? "").localeCompare(b.brandSlug ?? ""));
  return groups;
}
