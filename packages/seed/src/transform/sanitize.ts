import { sanitizeHtml, htmlToText, encPath } from "@namilux/core";
import { cleanText, stripControl } from "./zwnj.js";
import { ORIGIN_RE, toPath } from "./slugs.js";
import { normalizeUploadUrl } from "../extract/media-index.js";

export type ContentImageResolver = (sourceUrl: string) => string | null;

export type SanitizeOutcome = {
  html: string;
  droppedImages: number;
  droppedVideos: number;
  rewrittenLinks: number;
  externalLinks: number;
  text: string;
  words: number;
};

/** Elements removed outright by preClean (the spec + legacy Elementor/WP embeds). */
export const REMOVED_TAGS: readonly string[] = ["video", "audio", "iframe", "script", "style", "form", "input", "button", "svg", "object", "embed", "noscript"];
/** Elements unwrapped (children kept). */
export const UNWRAPPED_TAGS: readonly string[] = ["div", "section", "article", "span", "font", "center", "header", "footer", "main", "aside"];
/** Heading demotion map. */
export const HEADING_MAP: Record<string, string> = { h1: "h2", h5: "h4", h6: "h4", b: "strong", i: "em" };
/** Max acceptable word loss between raw and sanitised body (the spec content preservation). */
export const MAX_WORD_LOSS_RATIO = 0.05;

// ---------------------------------------------------------------- internals
/** Embeds whose removal is reported as a dropped video (the spec + the 4 wp-video products). */
const MEDIA_EMBED_TAGS: readonly string[] = ["video", "audio", "iframe", "object", "embed"];
/** Structural leftovers of a removed embed / of WP markup - dropped without a counter. */
const SILENT_DROP_TAGS: readonly string[] = ["source", "track", "param", "link", "meta", "base", "col", "colgroup", "wbr"];
/** The only attributes that survive preClean (core keeps table tags; the spec keeps no styling). */
const KEPT_TABLE_ATTRS: readonly string[] = ["colspan", "rowspan"];
const VOID_TAGS: readonly string[] = ["br", "hr", "img"];
/** Unwrapped tags that are inline: they leave no gap behind (see the unwrap DECISION below). */
const INLINE_UNWRAPPED_TAGS: readonly string[] = ["span", "font"];

const REMOVED_SET = new Set([...REMOVED_TAGS, ...MEDIA_EMBED_TAGS, ...SILENT_DROP_TAGS]);
const MEDIA_EMBED_SET = new Set(MEDIA_EMBED_TAGS);
const UNWRAPPED_SET = new Set(UNWRAPPED_TAGS);

const TAG_RE = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
/** WordPress shortcodes: "[caption id=…]" / "[/caption]" - the wrapper goes, the inner text stays. */
const SHORTCODE_RE = /\[\/?[a-zA-Z][^\]\n]{0,200}\]/g;
/** Entities are masked before cleanText so faDigits never rewrites "&#1740;" into "&#۱۷۴۰;". */
const ENTITY_RE = /&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;
const MASK_OPEN = "\u{E000}";
const MASK_CLOSE = "\u{E001}";
const MASK_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const EMPTY_BLOCK_RE = /<(p|li|figure|figcaption|blockquote)\b[^>]*>(?:\s|&nbsp;|&#160;|<br\s*\/?>)*<\/\1\s*>/gi;
const UNSAFE_SCHEME_RE = /^\s*(?:javascript|data|vbscript|file|about)\s*:/i;
const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const MEDIA_PATH_PREFIX = "/media/";

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === "") return out;
  ATTR_RE.lastIndex = 0;
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = (m[1] ?? "").toLowerCase();
    if (name === "") continue;
    out[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

/** Index → a Latin-only placeholder: cleanText leaves it alone (no digits, no Persian, no space). */
function maskToken(index: number): string {
  let n = index;
  let token = "";
  do {
    token = MASK_ALPHABET.charAt(n % 26) + token;
    n = Math.floor(n / 26);
  } while (n > 0);
  return MASK_OPEN + token + MASK_CLOSE;
}

/**
 * Text nodes get the write-time Persian pass - but the leading/trailing whitespace must
 * survive, otherwise «<strong>الف</strong> ب» fuses into «الفب» (the v2 §6.6 bug).
 */
function cleanTextNode(raw: string): string {
  if (raw === "") return "";
  if (raw.trim() === "") return raw.replace(/\s+/g, " ");
  const entities: string[] = [];
  const masked = raw.replace(ENTITY_RE, (e) => {
    entities.push(e);
    return maskToken(entities.length - 1);
  });
  const lead = /^\s/.test(masked) ? " " : "";
  const trail = /\s$/.test(masked) ? " " : "";
  let cleaned = lead + cleanText(masked) + trail;
  cleaned = cleaned.replace(new RegExp(`${MASK_OPEN}([a-z]+)${MASK_CLOSE}`, "g"), (_m, token: string) => {
    let index = 0;
    for (const ch of token) index = index * 26 + MASK_ALPHABET.indexOf(ch);
    return entities[index] ?? "";
  });
  return cleaned;
}

// DECISION: the internal-link path is computed by ./slugs toPath (strip origin, decode,
// trailing slash) and re-encoded by core encPath, so the seed emits the same lowercase-hex
// form the 752-URL contract expects.
/** Strip query/hash, then decode → re-encode with lowercase hex and a trailing slash. */
function internalHref(href: string): string {
  const withoutQuery = href.split("#")[0]?.split("?")[0] ?? "";
  return encPath(toPath(withoutQuery));
}

function isInternal(href: string, siteOrigin: string): boolean {
  if (ORIGIN_RE.test(href)) return true;
  const origin = siteOrigin.replace(/\/+$/, "");
  if (origin !== "" && href.toLowerCase().startsWith(origin.toLowerCase())) return true;
  return href.startsWith("/") && !href.startsWith("//");
}

// ---------------------------------------------------------------- contract
export function preClean(
  html: string,
  i: { resolveImage: ContentImageResolver; siteOrigin: string },
): { html: string; droppedImages: number; droppedVideos: number; rewrittenLinks: number; externalLinks: number } {
  let droppedImages = 0;
  let droppedVideos = 0;
  let rewrittenLinks = 0;
  let externalLinks = 0;
  if (typeof html !== "string" || html === "") {
    return { html: "", droppedImages, droppedVideos, rewrittenLinks, externalLinks };
  }

  // 1. Embeds and scripts go with their content (a whitelist cannot recover their text).
  let work = html;
  for (const tag of new Set([...REMOVED_TAGS, ...MEDIA_EMBED_TAGS])) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const lone = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    if (MEDIA_EMBED_SET.has(tag)) {
      droppedVideos += (work.match(paired) ?? []).length;
      work = work.replace(paired, " ");
      const leftovers = (work.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) ?? []).length;
      droppedVideos += leftovers;
    } else {
      work = work.replace(paired, " ");
    }
    work = work.replace(lone, " ");
  }
  // 2. WP shortcodes: the wrapper only.
  work = work.replace(SHORTCODE_RE, "");

  // 3. Walk the remaining tags.
  let out = "";
  let cursor = 0;
  let dropNextAnchorClose = false;
  TAG_RE.lastIndex = 0;
  for (const m of work.matchAll(TAG_RE)) {
    const at = m.index ?? 0;
    out += cleanTextNode(work.slice(cursor, at));
    cursor = at + m[0].length;

    const rawTag = m[1];
    if (rawTag === undefined) continue; // comment
    const tag = rawTag.toLowerCase();
    const closing = m[0].startsWith("</");
    const attrs = parseAttrs(m[2] ?? "");

    if (REMOVED_SET.has(tag)) continue;
    if (UNWRAPPED_SET.has(tag)) {
      // DECISION: unwrapping a BLOCK container leaves a space behind. «<div>الف</div><div>ب</div>»
      // would otherwise fuse into «الفب» - the v2 §6.6 bug. Inline span/font unwrap to nothing,
      // which is what a browser renders.
      if (!INLINE_UNWRAPPED_TAGS.includes(tag)) out += " ";
      continue;
    }

    if (tag === "img") {
      if (closing) continue;
      const src = (attrs["src"] ?? "").trim();
      if (src === "" || UNSAFE_SCHEME_RE.test(src)) {
        droppedImages += 1;
        continue;
      }
      const resolved = src.startsWith(MEDIA_PATH_PREFIX)
        ? src
        : i.resolveImage(normalizeUploadUrl(src));
      if (resolved === null || resolved === "") {
        droppedImages += 1;
        continue;
      }
      // width/height/srcset/sizes/loading/class are dropped; alt survives (filled later if empty).
      out += `<img src="${escapeAttr(resolved)}" alt="${escapeAttr(cleanTextNode(attrs["alt"] ?? "").trim())}" />`;
      continue;
    }

    if (tag === "a") {
      if (closing) {
        if (dropNextAnchorClose) dropNextAnchorClose = false;
        else out += "</a>";
        continue;
      }
      const href = (attrs["href"] ?? "").trim();
      if (href === "" || UNSAFE_SCHEME_RE.test(href)) {
        dropNextAnchorClose = true; // unwrap: the text survives, the link does not
        continue;
      }
      if (isInternal(href, i.siteOrigin)) {
        const rewritten = internalHref(href);
        if (rewritten !== href) rewrittenLinks += 1;
        out += `<a href="${escapeAttr(rewritten)}">`;
        continue;
      }
      if (ABSOLUTE_URL_RE.test(href) && !/^(?:https?):/i.test(href)) {
        out += `<a href="${escapeAttr(href)}">`; // mailto:/tel: - core filters the rest
        continue;
      }
      externalLinks += 1;
      // target is dropped on purpose: no new tabs on mobile.
      out += `<a href="${escapeAttr(href)}" rel="noopener nofollow">`;
      continue;
    }

    const mapped = HEADING_MAP[tag] ?? tag;
    if (closing) {
      if (!VOID_TAGS.includes(mapped)) out += `</${mapped}>`;
      continue;
    }
    let kept = "";
    if (mapped === "td" || mapped === "th") {
      for (const name of KEPT_TABLE_ATTRS) {
        const value = attrs[name];
        if (value !== undefined && value !== "") kept += ` ${name}="${escapeAttr(value)}"`;
      }
    }
    out += VOID_TAGS.includes(mapped) ? `<${mapped} />` : `<${mapped}${kept}>`;
  }
  out += cleanTextNode(work.slice(cursor));

  // 4. Empty wrappers (Elementor leaves many) - repeat until stable, nested ones collapse too.
  let previous = "";
  while (previous !== out) {
    previous = out;
    out = out.replace(EMPTY_BLOCK_RE, "");
  }

  return { html: out.trim(), droppedImages, droppedVideos, rewrittenLinks, externalLinks };
}

export function sanitizeLegacyHtml(
  html: string,
  i: { resolveImage: ContentImageResolver; siteOrigin: string; allowImages?: boolean },
): SanitizeOutcome {
  const pre = preClean(html, { resolveImage: i.resolveImage, siteOrigin: i.siteOrigin });
  // Core sanitizeHtml ALWAYS runs last - preClean is never trusted alone.
  const safe = sanitizeHtml(pre.html, { allowImages: i.allowImages ?? true })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const text = htmlToText(safe);
  return {
    html: safe,
    droppedImages: pre.droppedImages,
    droppedVideos: pre.droppedVideos,
    rewrittenLinks: pre.rewrittenLinks,
    externalLinks: pre.externalLinks,
    text,
    words: text === "" ? 0 : text.split(/\s+/).filter((w) => w !== "").length,
  };
}

export function collectImageUrls(html: string): string[] {
  if (typeof html !== "string" || html === "") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  IMG_SRC_RE.lastIndex = 0;
  for (const m of html.matchAll(IMG_SRC_RE)) {
    const src = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    // DECISION: data: URIs are skipped (never processed) and already-local /media/ sources are
    // skipped too - importers/media.ts only needs the legacy originals.
    if (src === "" || UNSAFE_SCHEME_RE.test(src) || src.startsWith(MEDIA_PATH_PREFIX)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

export function stripTags(html: string): string {
  // DECISION: core exposes no "no tags" sanitize option; htmlToText IS the core primitive for
  // "tags out, entities decoded" (the spec §html), so titles/excerpts go through it plus stripControl.
  return stripControl(htmlToText(html));
}
