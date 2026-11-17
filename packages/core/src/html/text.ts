import { truncateWords } from "../persian/format";
import { faNorm } from "../persian/normalize";

export const WORDS_PER_MINUTE = 200;

/** Tags that end a line of text. Everything else is an inline tag. */
const BLOCK_TAG_RE = /<\/?(?:p|div|li|ul|ol|br|h[1-6]|tr|table|thead|tbody|blockquote|figure|figcaption|hr|section|article|header|footer|aside|dl|dt|dd|pre)\b[^>]*>/gi;
/** Any remaining tag (including comments and malformed leftovers). */
const ANY_TAG_RE = /<!--[\s\S]*?-->|<[^>]*>/g;

// DECISION: block tags become "\n" and every OTHER tag becomes " " (not ""). The header's own
// edge case htmlToText("<script>x</script>y") === "x y" requires a separator for inline tags too,
// and a separator is the safe side of the v2 §6.6 fused-words bug ("یکدو"). Collapsing then makes
// the two indistinguishable inside a line.
const INLINE_SEPARATOR = " ";

/** The named entities that appear in the legacy WordPress content (the spec output is re-escaped). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  zwnj: "‌",
  zwj: "‍",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  middot: "·",
  bull: "•",
  deg: "°",
  times: "×",
  rlm: "‏",
  lrm: "‎",
  shy: "",
};

/** One pass so "&amp;lt;" decodes to "&lt;" and never to "<". Unknown entities are kept verbatim. */
function decodeEntities(s: string): string {
  return s.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/** Whitespace inside a line collapses; ZWNJ/ZWJ are NOT whitespace and survive. */
function collapseLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** html → the non-empty text lines, in order. Shared by htmlToText and firstParagraph. */
function htmlToLines(html: string): string[] {
  if (typeof html !== "string" || html === "") return [];
  const withBreaks = html.replace(BLOCK_TAG_RE, "\n").replace(ANY_TAG_RE, INLINE_SEPARATOR);
  return decodeEntities(withBreaks)
    .split("\n")
    .map(collapseLine)
    .filter((l) => l !== "");
}

export function htmlToText(html: string, maxWords?: number): string {
  const text = htmlToLines(html).join(" ");
  return maxWords === undefined ? text : truncateWords(text, maxWords);
}

/**
 * Legacy spec strings are one fused blob per product; split before stripping tags (v2 §6.6).
 * "،" and "؛" are Persian prose punctuation and are deliberately NOT separators.
 */
export function splitListItems(html: string): string[] {
  if (typeof html !== "string" || html === "") return [];
  const parts = html
    .replace(/<\s*\/?\s*li\b[^>]*>/gi, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/?\s*p\b[^>]*>/gi, "\n")
    .replace(/[•·]/g, "\n")
    .split(/\r\n|\r|\n/);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const text = htmlToText(part);
    if (text === "") continue;
    const key = faNorm(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function wordCount(html: string): number {
  const text = htmlToText(html);
  if (text === "") return 0;
  return text.split(/\s+/).filter((w) => w !== "").length;
}

export function readMinutes(html: string): number {
  return Math.max(1, Math.ceil(wordCount(html) / WORDS_PER_MINUTE));
}

export function firstParagraph(html: string): string {
  if (typeof html !== "string" || html === "") return "";
  for (const match of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)) {
    const text = htmlToText(match[1] ?? "");
    if (text !== "") return text;
  }
  return htmlToLines(html)[0] ?? "";
}
