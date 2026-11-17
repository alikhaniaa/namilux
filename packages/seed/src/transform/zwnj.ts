import { faZwnj, faDigits, htmlToText, truncateWords, splitLatinRuns } from "@namilux/core";

/** Default excerpt budget in characters (v1 ingest used the same 240 for post excerpts). */
export const EXCERPT_MAX_CHARS = 240;

// DECISION: the contract lists C0 (U+0000–U+001F), DEL, BOM and U+FFFD. The bidi
// overrides/isolates (U+202A–U+202E, U+2066–U+2069) are stripped too: a display string carrying
// RLO is a spoofing vector and `@namilux/core` stripControl removes them for the same
// reason, so the seed's display pass stays a superset, never a weaker filter.
// eslint-disable-next-line no-control-regex -- this function exists to remove exactly these
const CONTROL_RE = /[\u0000-\u001F\u007F\uFEFF\uFFFD\u202A-\u202E\u2066-\u2069]/g;
/** JS \s already covers NBSP and the line/paragraph separators; ZWNJ (U+200C) is NOT \s. */
const WHITESPACE_RE = /\s+/g;
/** Display-safe Arabic→Persian folding (contract: ي ى → ی, ك → ک, ە → ه). */
const ARABIC_LETTER_RE = /[يىكە]/g;
const ARABIC_LETTER_MAP: Record<string, string> = {
  "ي": "ی", // ي
  "ى": "ی", // ى
  "ك": "ک", // ك
  "ە": "ه", // ە
};
/** Spec group headers arrive as «اقلام همراه:» - the colon is markup, not content. */
const TRAILING_COLON_RE = /[:：﹕︓]+[\s‌]*$/;
const ASCII_DIGIT_RE = /[0-9]/;

export function stripControl(s: string): string {
  if (typeof s !== "string" || s === "") return "";
  // DECISION: whitespace folds to a space FIRST. \t \n \r sit inside the C0 range the contract
  // removes, and deleting them outright would fuse two words ("a\tb" → "ab") - exactly the
  // v2 §6.6 bug this layer exists to prevent. The second collapse tidies what the strip left.
  return s.replace(WHITESPACE_RE, " ").replace(CONTROL_RE, "").replace(WHITESPACE_RE, " ").trim();
}

export function fixArabicLetters(s: string): string {
  if (typeof s !== "string" || s === "") return "";
  return s.replace(ARABIC_LETTER_RE, (ch) => ARABIC_LETTER_MAP[ch] ?? ch);
}

export function cleanText(s: string): string {
  if (typeof s !== "string" || s === "") return "";
  const folded = fixArabicLetters(stripControl(s));
  // guard=true keeps Latin model designators intact ("KLF04", "V16s", "HS08") - the spec
  return faDigits(faZwnj(folded), true).trim();
}

export function cleanLabel(s: string): string {
  return cleanText(s).replace(TRAILING_COLON_RE, "").trim();
}

export function excerptFrom(htmlOrText: string, maxChars: number = EXCERPT_MAX_CHARS): string {
  // DECISION: excerpts are DISPLAY strings (see WHAT), so cleanText runs before the cut - the
  // character budget then counts the glyphs that actually reach the page.
  const text = cleanText(htmlToText(htmlOrText));
  if (text === "") return "";
  if (text.length <= maxChars) return text;

  const words = text.split(" ");
  let kept = 0;
  let length = 0;
  for (const word of words) {
    const next = kept === 0 ? word.length : length + 1 + word.length;
    if (next > maxChars) break;
    length = next;
    kept += 1;
  }
  // DECISION: a single word longer than the budget is kept whole - "never mid-word" (v2 §10.3.5)
  // outweighs the cap, and truncateWords also drops the trailing punctuation before the ellipsis.
  return truncateWords(text, Math.max(1, kept));
}

export function hasLatinDigits(s: string): boolean {
  if (typeof s !== "string" || s === "") return false;
  return splitLatinRuns(s).some((run) => !run.latin && ASCII_DIGIT_RE.test(run.text));
}
