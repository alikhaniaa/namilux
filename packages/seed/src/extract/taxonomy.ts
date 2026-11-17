import { readFile } from "node:fs/promises";
import { faNorm, faZwnj } from "@namilux/core";
import { extractPath } from "./paths.js";

export type LegacyColorTerm = { id: number; nameFa: string; slug: string; count: number };

export const COLOR_ATTRIBUTE = {
  key: "color",
  label: "رنگ",
  unit: null,
  kind: "color",
  isFilterable: true,
  isComparable: true,
  sort: 0,
} as const;

/** Ordered longest-first at use time (see rules). Source: v2 §6.3 + the 21 pa_color terms + finish modifiers. */
export const COLOR_TOKENS_FA: readonly string[] = [
  "سبز سرامیکی",
  "طوسی صورتی",
  "طوسی مسی",
  "کرم صورتی",
  "ابی کاربنی",
  "آبی کاربنی",
  "دولچی گابانا",
  "سبز مات",
  "سورمه ای",
  "سورمه‌ای",
  "سرمه ای",
  "سرمه‌ای",
  "نقره ای",
  "نقره‌ای",
  "رز گلد",
  "رزگلد",
  "شامپاین",
  "استیل",
  "مشکی",
  "سفید",
  "قرمز",
  "کرم",
  "سبز",
  "آبی",
  "ابی",
  "صورتی",
  "طوسی",
  "مسی",
  "زرد",
  "بنفش",
  "نارنجی",
  "طلایی",
  "فوشیا",
  "براق",
  "مات",
  "پاستیلی",
  "سرامیکی",
  "کاربنی",
  "نیوکالکشن",
  "رنگ",
];

export const COLOR_TOKENS_EN: readonly string[] = [
  "rosegold",
  "rose gold",
  "champagne",
  "black",
  "white",
  "red",
  "cream",
  "green",
  "blue",
  "pink",
  "grey",
  "gray",
  "silver",
  "copper",
  "gold",
  "rose",
  "steel",
  "navy",
  "purple",
  "yellow",
  "orange",
  "fuchsia",
  "glossy",
  "matte",
  "pastel",
  "new",
];

/** The Store API key that holds the 21 `pa_color` terms. */
export const COLOR_TERMS_KEY = "2_pa_color";

/**
 * DECISION: core `faZwnj` only knows the v2 suffix/prefix/compound table, which does not cover the
 * standalone «ای» adjective ending nor «رز گلد». The colour vocabulary therefore carries its own
 * spelling fixes here (the header requires «سورمه ای» → «سورمه‌ای» and «رز گلد» → «رزگلد»); no new
 * orthography rule is added to core.
 */
const COLOR_SPELLING_FIXES: readonly [spaced: string, canonical: string][] = [
  ["رز گلد", "رزگلد"],
  ["نیو کالکشن", "نیوکالکشن"],
];

/** «<حرف فارسی> ای» at a word boundary is one word joined by ZWNJ («سورمه ای» → «سورمه‌ای»). */
const FA_YE_SUFFIX_RE = /(\p{Script=Arabic})\s+ای(?=$|[\s\p{P}])/gu;

const ZWNJ = "\u200c";

function stripControl(s: string): string {
  // \p{Cc} covers C0/C1 + DEL without writing a literal control char into the source.
  return (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\ufeff\ufffd]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Display-safe Arabic→Persian letter fix: no lowercasing, no digit folding, no ZWNJ removal. */
function fixArabicLetters(s: string): string {
  return (s ?? "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/ۀ/g, "ه").replace(/ة/g, "ه");
}

type RawTerm = { id?: unknown; name?: unknown; slug?: unknown; count?: unknown };

function decodeTolerant(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function readColorTerms(dir: string): Promise<LegacyColorTerm[]> {
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "taxonomiesStoreJson"), "utf8"));
  const terms = (parsed as { attributeTerms?: Record<string, unknown> } | null)?.attributeTerms?.[COLOR_TERMS_KEY];
  if (!Array.isArray(terms)) return [];
  const out: LegacyColorTerm[] = [];
  for (const t of terms as RawTerm[]) {
    if (!t || typeof t !== "object") continue;
    const id = Number(t.id);
    if (!Number.isFinite(id)) continue;
    out.push({
      id,
      nameFa: stripControl(typeof t.name === "string" ? t.name : ""),
      slug: decodeTolerant(typeof t.slug === "string" ? t.slug : ""),
      count: Number(t.count) || 0,
    });
  }
  return out;
}

export function canonicalColorName(raw: string): string {
  let s = fixArabicLetters(stripControl(raw));
  if (!s) return "";
  for (const [spaced, canonical] of COLOR_SPELLING_FIXES) {
    s = s.split(spaced).join(canonical);
  }
  s = s.replace(FA_YE_SUFFIX_RE, `$1${ZWNJ}ای`);
  // Compound names such as «سفید-طلایی» are one value: the hyphen is never split or replaced.
  return faZwnj(s);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest first so «سبز سرامیکی» is matched before «سبز» (rules). */
const COLOR_TOKENS_FA_BY_LENGTH: readonly string[] = [...COLOR_TOKENS_FA].sort((a, b) => b.length - a.length);

/** «رنگ» is the word "colour" itself, never a colour value. */
const NON_COLOR_TOKENS: readonly string[] = ["رنگ"];

export function colorFromName(name: string): string | null {
  const norm = faNorm(name ?? "");
  if (!norm) return null;
  for (const token of COLOR_TOKENS_FA_BY_LENGTH) {
    if (NON_COLOR_TOKENS.includes(token)) continue;
    const needle = faNorm(token);
    if (!needle) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(norm)) return token;
  }
  return null;
}
