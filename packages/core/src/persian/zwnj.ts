export const ZWNJ = "‌";

export const SUFFIXES = ["ها", "های", "هایی", "تر", "ترین", "ام", "ات", "اش", "مان", "تان", "شان"] as const;
export const PREFIXES = ["می", "نمی", "بی"] as const;

/** [spaced, joined] - whole-word replacements applied longest-first (see rules). */
export const COMPOUNDS: readonly [string, string][] = [
  ["آب مرکبات گیر", "آب‌مرکبات‌گیر"],
  ["آب میوه گیر", "آب‌میوه‌گیر"],
  ["آبمیوه گیر", "آبمیوه‌گیر"],
  ["آب گرم کن", "آب‌گرم‌کن"],
  ["ایرپ استایلر", "ایرپ‌استایلر"],
  ["جارو شارژی", "جاروشارژی"],
  ["جارو برقی", "جاروبرقی"],
  ["حالت دهنده", "حالت‌دهنده"],
  ["چرخ گوشت", "چرخ‌گوشت"],
  ["مخلوط کن", "مخلوط‌کن"],
  ["نامی لوکس", "نامی‌لوکس"],
  ["نیم فاصله", "نیم‌فاصله"],
  ["اتو بخار", "اتوبخار"],
  ["آرام پز", "آرام‌پز"],
  ["بخار پز", "بخارپز"],
  ["به زودی", "به‌زودی"],
  ["پیش بند", "پیش‌بند"],
  ["چای ساز", "چای‌ساز"],
  ["زود پز", "زودپز"],
  ["سرخ کن", "سرخ‌کن"],
  ["غذا ساز", "غذاساز"],
  ["قهوه ساز", "قهوه‌ساز"],
  ["هوا پز", "هواپز"],
  ["پلو پز", "پلوپز"],
  ["بی سیم", "بی‌سیم"],
  ["به روز", "به‌روز"],
];

// ---------------------------------------------------------------- internals
// DECISION: rules quote `(\p{Script=Arabic})` and add "(digits and Latin are excluded on
// purpose)" - but Persian digits U+06F0–U+06F9 *are* Script=Arabic. The extra `(?=\p{L})`
// lookahead is what makes that parenthetical true; the rest of the pattern is verbatim.
const FA_LETTER = "(?=\\p{L})\\p{Script=Arabic}";
const HAS_FA_LETTER_RE = /(?=\p{L})\p{Script=Arabic}/u;
const SUFFIX_RE = new RegExp(`(${FA_LETTER}) (${SUFFIXES.join("|")})(?=$|[\\s\\p{P}])`, "gu");
const PREFIX_RE = new RegExp(`(?<=^|[\\s\\p{P}«»])(${PREFIXES.join("|")}) (?=${FA_LETTER})`, "gu");

const ZWNJ_RUN_RE = /\u200C{2,}/g;
const ZWNJ_AT_SPACE_RE = /(?<=\s)\u200C|\u200C(?=\s)/g;
const ZWNJ_AT_EDGE_RE = /^\u200C+|\u200C+$/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word compound replacements, longest spaced form first (rules rule 3). */
const COMPOUND_RULES: readonly { re: RegExp; joined: string }[] = COMPOUNDS.filter(
  ([spaced, joined]) => spaced !== joined,
)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([spaced, joined]) => ({
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(spaced)}(?![\\p{L}\\p{N}])`, "gu"),
    joined,
  }));

/** Rule 4 - one ZWNJ at most, never touching whitespace, never at an end. */
function cleanZwnj(s: string): string {
  return s.replace(ZWNJ_RUN_RE, ZWNJ).replace(ZWNJ_AT_SPACE_RE, "").replace(ZWNJ_AT_EDGE_RE, "");
}

// ---------------------------------------------------------------- contract
export function faZwnj(s: string): string {
  if (typeof s !== "string") return "";
  if (s === "" || !HAS_FA_LETTER_RE.test(s)) return s;
  // Rule 4 runs first as well, so «ویژگی‌ ها» reaches the suffix rule as «ویژگی ها».
  let out = cleanZwnj(s);
  for (const rule of COMPOUND_RULES) out = out.replace(rule.re, rule.joined);
  out = out.replace(PREFIX_RE, "$1" + ZWNJ);
  out = out.replace(SUFFIX_RE, "$1" + ZWNJ + "$2");
  return cleanZwnj(out);
}

export function hasMissingZwnj(s: string): boolean {
  return faZwnj(s) !== s;
}
