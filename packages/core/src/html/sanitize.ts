import sanitize from "sanitize-html";
import type { IOptions, IFrame } from "sanitize-html";

export const MEDIA_SRC_PREFIX = "/media/";

const ALLOWED_TAGS_BASE = [
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "blockquote",
  "br",
  "hr",
] as const;

const ALLOWED_TAGS_IMAGES = ["img", "figure", "figcaption"] as const;

const NON_TEXT_TAGS = [
  "script",
  "style",
  "textarea",
  "option",
  "noscript",
  "iframe",
  "template",
  "svg",
  "math",
  "object",
  "embed",
] as const;

const EMPTY_BLOCK_TAGS = new Set(["p", "li", "h2", "h3", "h4"]);

/** Drops <img> outside /media/, <a> without a surviving href, and empty text blocks. */
export function exclusiveFilter(frame: IFrame): boolean {
  if (frame.tag === "img") {
    const src = frame.attribs["src"] ?? "";
    return !src.startsWith(MEDIA_SRC_PREFIX);
  }
  if (frame.tag === "a") {
    return !(frame.attribs["href"] ?? "").trim();
  }
  if (EMPTY_BLOCK_TAGS.has(frame.tag)) {
    return frame.text.trim() === "" && !frame.mediaChildren.includes("img");
  }
  return false;
}

/** The DECIDED whitelist of the spec. */
export const SANITIZE_OPTIONS: IOptions = {
  allowedTags: [...ALLOWED_TAGS_BASE, ...ALLOWED_TAGS_IMAGES],
  allowedAttributes: {
    a: ["href"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["https", "mailto", "tel"],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  allowedStyles: {},
  allowedClasses: {},
  allowVulnerableTags: false,
  disallowedTagsMode: "discard",
  nonTextTags: [...NON_TEXT_TAGS],
  enforceHtmlBoundary: true,
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
  transformTags: {
    h1: "h2",
    h5: "h4",
    h6: "h4",
    b: "strong",
    i: "em",
  },
  exclusiveFilter,
};

/** Same whitelist without img/figure/figcaption (short_html, FAQ answers). */
export const SANITIZE_OPTIONS_NO_IMAGES: IOptions = {
  ...SANITIZE_OPTIONS,
  allowedTags: [...ALLOWED_TAGS_BASE],
  allowedAttributes: { a: ["href"] },
};

/**
 * The ONE sanitizer. Output is the only string `RichHtml` may hand to dangerouslySetInnerHTML.
 * Non-string input (legacy NULLs) → "" rather than throwing: a broken description must not 500.
 */
export function sanitizeHtml(html: string, opts?: { allowImages?: boolean }): string {
  if (typeof html !== "string" || html === "") return "";
  const allowImages = opts?.allowImages ?? true;
  return sanitize(html, allowImages ? SANITIZE_OPTIONS : SANITIZE_OPTIONS_NO_IMAGES);
}

/** True when the string is already a fixed point of the sanitizer (seed report, tests). */
export function isSanitized(html: string): boolean {
  if (typeof html !== "string") return false;
  return sanitizeHtml(html) === html;
}
