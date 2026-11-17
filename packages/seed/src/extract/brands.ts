import { readFile } from "node:fs/promises";
import { faNorm } from "@namilux/core";
import { extractPath } from "./paths.js";

export type BrandSeed = {
  legacyId: number | null;
  slug: string;
  nameFa: string;
  nameEn: string;
  claim: string;
  sort: number;
  isActive: boolean;
  legacy: boolean;
};

/** LIFT from v1 ingest.mjs BRAND_META. Claims are DECIDED copy (the spec cites the SMEG one). */
export const LEGACY_BRAND_META: Record<string, { en: string; claim: string }> = {
  dyson: { en: "Dyson", claim: "مهندسی‌ای که دیده نمی‌شود." },
  smeg: { en: "SMEG", claim: "زیبایی، به شکل یک وسیلهٔ خانگی." },
  sage: { en: "Sage", claim: "قهوهٔ کافه، در خانه." },
  breville: { en: "Breville", claim: "ابزار دقیق آشپزخانه." },
  figaro: { en: "Figaro", claim: "سادگی کاربردی." },
  bambum: { en: "Bambum", claim: "طبیعت، سر میز." },
  como: { en: "Como", claim: "انتخاب‌های روزمره." },
};

/** Brands with inventory but no legacy page (v2 §11.1, F-013). Claims are OPEN(owner) - left empty, never invented. */
export const NEW_BRANDS: readonly BrandSeed[] = [
  { legacyId: null, slug: "ninja", nameFa: "نینجا", nameEn: "Ninja", claim: "", sort: 100, isActive: true, legacy: false },
  { legacyId: null, slug: "tefal", nameFa: "تفال", nameEn: "Tefal", claim: "", sort: 101, isActive: true, legacy: false },
  { legacyId: null, slug: "berghoff", nameFa: "برگهف", nameEn: "BergHOFF", claim: "", sort: 102, isActive: true, legacy: false },
  { legacyId: null, slug: "moai", nameFa: "موآی", nameEn: "Moai", claim: "", sort: 103, isActive: true, legacy: false },
  { legacyId: null, slug: "bissell", nameFa: "بیسل", nameEn: "Bissell", claim: "", sort: 104, isActive: true, legacy: false },
  { legacyId: null, slug: "philips", nameFa: "فیلیپس", nameEn: "Philips", claim: "", sort: 105, isActive: true, legacy: false },
];

/** lowercase token (faNorm'd for Persian) → brand slug. */
export const BRAND_ALIASES: Record<string, string> = {
  smeg: "smeg",
  اسمگ: "smeg",
  dyson: "dyson",
  دایسون: "dyson",
  sage: "sage",
  سیج: "sage",
  "sage / breville": "sage",
  breville: "breville",
  برویل: "breville",
  figaro: "figaro",
  فیگارو: "figaro",
  bambum: "bambum",
  "بم بوم": "bambum",
  como: "como",
  کومو: "como",
  ninja: "ninja",
  نینجا: "ninja",
  tefal: "tefal",
  تفال: "tefal",
  berghoff: "berghoff",
  برگهف: "berghoff",
  moai: "moai",
  موآی: "moai",
  bissell: "bissell",
  بیسل: "bissell",
  philips: "philips",
  فیلیپس: "philips",
};

export const UNIDENTIFIED_BRAND_TOKENS: readonly string[] = ["unidentified", "نامشخص"];

/** The Store API key that holds the 7 legacy `pa_brand` terms, in menu order. */
export const BRAND_TERMS_KEY = "1_pa_brand";

/** Sort offset for brands that have inventory but never had a legacy page (v2 §11.1). */
export const NEW_BRAND_SORT_BASE = 100;

export type BrandSource = "pa_brand" | "custom" | "commerce_brands" | "curated" | "name" | null;

/** `BRAND_ALIASES` keyed by the same normalisation used on the haystack, built once. */
const NORMALIZED_ALIASES: ReadonlyMap<string, string> = new Map(
  Object.entries(BRAND_ALIASES).map(([token, slug]) => [faNorm(token), slug]),
);

const NORMALIZED_UNIDENTIFIED: ReadonlySet<string> = new Set(UNIDENTIFIED_BRAND_TOKENS.map((t) => faNorm(t)));

/** Longest alias first so a two-word alias («بم بوم») wins over any single token inside it. */
const MAX_ALIAS_WORDS = Math.max(1, ...[...NORMALIZED_ALIASES.keys()].map((k) => k.split(" ").length));

function stripControl(s: string): string {
  // \p{Cc} covers C0/C1 + DEL without writing a literal control char into the source.
  return (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\ufeff\ufffd]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeTolerant(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Exact alias hit on the whole value ("Sage / Breville", «اسمگ», "smeg"). */
function aliasExact(value: string | null | undefined): string | null {
  const norm = faNorm(value ?? "");
  if (!norm || NORMALIZED_UNIDENTIFIED.has(norm)) return null;
  return NORMALIZED_ALIASES.get(norm) ?? null;
}

/** First alias occurring in the value, scanning left to right, longest n-gram at each position. */
function aliasInText(value: string | null | undefined): string | null {
  const norm = faNorm(value ?? "");
  if (!norm || NORMALIZED_UNIDENTIFIED.has(norm)) return null;
  const tokens = norm.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    for (let len = Math.min(MAX_ALIAS_WORDS, tokens.length - i); len >= 1; len -= 1) {
      const hit = NORMALIZED_ALIASES.get(tokens.slice(i, i + len).join(" "));
      if (hit) return hit;
    }
  }
  return null;
}

function resolveOne(value: string | null | undefined): string | null {
  return aliasExact(value) ?? aliasInText(value);
}

type RawTerm = { id?: unknown; name?: unknown; slug?: unknown; count?: unknown };

export async function readLegacyBrands(dir: string): Promise<BrandSeed[]> {
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "taxonomiesStoreJson"), "utf8"));
  const terms = (parsed as { attributeTerms?: Record<string, unknown> } | null)?.attributeTerms?.[BRAND_TERMS_KEY];
  const legacy: BrandSeed[] = [];
  if (Array.isArray(terms)) {
    let sort = 1;
    for (const t of terms as RawTerm[]) {
      if (!t || typeof t !== "object") continue;
      const id = Number(t.id);
      const slug = decodeTolerant(typeof t.slug === "string" ? t.slug : "").trim();
      if (!Number.isFinite(id) || !slug) continue;
      const meta = LEGACY_BRAND_META[slug];
      legacy.push({
        // Legacy ids are written verbatim - the /brand/<slug>/ URLs are in the 752-URL contract.
        legacyId: id,
        slug,
        nameFa: stripControl(typeof t.name === "string" ? t.name : ""),
        nameEn: meta?.en ?? slug,
        claim: meta?.claim ?? "",
        sort,
        isActive: true,
        legacy: true,
      });
      sort += 1;
    }
  }
  return [
    ...legacy,
    ...NEW_BRANDS.map((b, i) => ({ ...b, sort: NEW_BRAND_SORT_BASE + i })),
  ];
}

export function resolveBrandSlug(i: {
  paBrandSlug: string | null;
  customBrand: string | null;
  commerceBrand: string | null;
  curatedBrandEn: string | null;
  name: string;
}): { slug: string | null; source: BrandSource } {
  const pa = resolveOne(i.paBrandSlug ? decodeTolerant(i.paBrandSlug) : null);
  if (pa) return { slug: pa, source: "pa_brand" };
  const custom = resolveOne(i.customBrand);
  if (custom) return { slug: custom, source: "custom" };
  const commerce = resolveOne(i.commerceBrand ? decodeTolerant(i.commerceBrand) : null);
  if (commerce) return { slug: commerce, source: "commerce_brands" };
  const curated = resolveOne(i.curatedBrandEn);
  if (curated) return { slug: curated, source: "curated" };
  // Last resort: the first brand word inside the product name ("tefal masterchop xxl …").
  const byName = aliasInText(i.name);
  if (byName) return { slug: byName, source: "name" };
  return { slug: null, source: null };
}
