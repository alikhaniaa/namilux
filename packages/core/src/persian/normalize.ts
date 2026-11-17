import { enDigits } from "./format";

// ---------------------------------------------------------------- internals
// Invisible characters are written as \u escapes on purpose: this table is the twin of the SQL
// function nl_fa_norm (packages/db/migrations/0000_extensions.sql) and must stay reviewable.

/** Step 2 - Arabic forms folded to their Persian twins. ؤ is NOT folded (distinct word). */
const ARABIC_LETTER_RE = /[يىكۀة]/g;
const ARABIC_LETTER_MAP: Record<string, string> = {
  "ي": "ی", // ي → ی
  "ى": "ی", // ى → ی
  "ك": "ک", // ك → ک
  "ۀ": "ه", // ۀ → ه
  "ة": "ه", // ة → ه
};
/** Step 3 - harakat U+064B–U+0652, superscript alef U+0670, tatweel U+0640. */
const DIACRITIC_RE = /[\u064B-\u0652\u0670\u0640]/g;
/** Step 4 - ZWNJ/ZWJ become a space so «ویژگی‌ها» matches «ویژگی ها» (LIFT v1). */
const JOINER_RE = /[\u200C\u200D]/g;
// DECISION: LRM/RLM and the soft hyphen are stripped too. The SQL twin nl_fa_norm strips them,
// this module does not mention them, and dropping them keeps the two in parity (asserted in
// the "SQL twin" test).
const INVISIBLE_RE = /[\u200E\u200F\u00AD]/g;
/** C0 minus \t \n \r, DEL, C1, bidi overrides/isolates, BOM. ZWNJ/ZWJ are kept on purpose. */
const CONTROL_RE =
  // eslint-disable-next-line no-control-regex -- stripControl exists to remove exactly these
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const WHITESPACE_RE = /\s+/g;
const SLUG_SEPARATOR_RE = /[-_]+/g;

// ---------------------------------------------------------------- contract
export function faNorm(s: string): string {
  // Legacy rows carry nulls - normalizing them must not throw (contract step 1).
  if (typeof s !== "string" || s === "") return "";
  let out = normalizeArabicLetters(s);
  out = stripDiacritics(out);
  out = out.replace(INVISIBLE_RE, "");
  out = out.replace(JOINER_RE, " ");
  out = enDigits(out);
  return collapseSpaces(out.toLowerCase());
}

export function stripControl(s: string): string {
  if (typeof s !== "string") return "";
  return s.replace(CONTROL_RE, "");
}

export function collapseSpaces(s: string): string {
  if (typeof s !== "string") return "";
  // JS \s already covers NBSP U+00A0, so this both folds and collapses it.
  return s.replace(WHITESPACE_RE, " ").trim();
}

export function normalizeArabicLetters(s: string): string {
  if (typeof s !== "string") return "";
  return s.replace(ARABIC_LETTER_RE, (ch) => ARABIC_LETTER_MAP[ch] ?? ch);
}

export function stripDiacritics(s: string): string {
  if (typeof s !== "string") return "";
  return s.replace(DIACRITIC_RE, "");
}

export function normalizeForSlugMatch(s: string): string {
  return collapseSpaces(faNorm(s).replace(SLUG_SEPARATOR_RE, " "));
}
