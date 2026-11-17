import { faNorm, truncateWords } from "@namilux/core";
import { cleanText } from "./zwnj.js";
import { MODEL_CODE_RE, KEY_NOISE_TOKENS } from "./model-key.js";
import { COLOR_TOKENS_FA, COLOR_TOKENS_EN } from "../extract/taxonomy.js";
import { BRAND_ALIASES } from "../extract/brands.js";

export const DISPLAY_NAME_MAX = 60;
export const SEPARATOR = " · ";

export type DisplayNameInput = {
  name: string;
  brandFa: string | null;
  typeFa: string | null;
  modelCode: string | null;
  colorName: string | null;
};

export type DisplayNameResult = { displayName: string; draft: boolean; reasons: string[] };

/** A derived type shorter than this is noise, not a product type (contract: "< 3 chars → null"). */
export const MIN_TYPE_CHARS = 3;

// ---------------------------------------------------------------- internals
const MODEL_CODE_RE_G = new RegExp(MODEL_CODE_RE.source, "gi");
/** Every Latin run: brand transliterations, model codes and scrape noise all leave the type. */
const LATIN_RUN_RE = /[A-Za-z][A-Za-z0-9]*/g;
const WORD_BOUNDARY_LEFT = "(?<![\\p{L}\\p{N}])";
const WORD_BOUNDARY_RIGHT = "(?![\\p{L}\\p{N}])";
const ELLIPSIS_RE = /…$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word removal rules for a token list, longest first (v2 §6.3 ordering rule). */
function removalRules(tokens: readonly string[]): RegExp[] {
  const normalized = [...new Set(tokens.map((t) => faNorm(t)).filter((t) => t !== ""))];
  normalized.sort((a, b) => b.length - a.length);
  return normalized.map((t) => new RegExp(`${WORD_BOUNDARY_LEFT}${escapeRe(t)}${WORD_BOUNDARY_RIGHT}`, "gu"));
}

const BRAND_TOKEN_RULES = removalRules(Object.keys(BRAND_ALIASES));
const COLOR_RULES = removalRules([...COLOR_TOKENS_FA, ...COLOR_TOKENS_EN]);
const NOISE_RULES = removalRules(KEY_NOISE_TOKENS);
/** Persian → slug, for the "duplicated brand fa+en" scrape signal. */
const BRAND_SLUG_RULES: { re: RegExp; slug: string }[] = Object.entries(BRAND_ALIASES).map(([token, slug]) => ({
  re: new RegExp(`${WORD_BOUNDARY_LEFT}${escapeRe(faNorm(token))}${WORD_BOUNDARY_RIGHT}`, "u"),
  slug,
}));

function applyRules(s: string, rules: readonly RegExp[]): string {
  let out = s;
  for (const re of rules) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

function nonEmpty(s: string | null): s is string {
  return typeof s === "string" && s.trim() !== "";
}

/** Assemble the rule: [برند] [نوع] [مدل] · [رنگ] (v2 §10.1), then the write-time text pass. */
function assemble(brandFa: string | null, type: string | null, modelCode: string | null, colorName: string | null): string {
  const head = [brandFa, type, modelCode].filter(nonEmpty).map((p) => p.trim()).join(" ");
  const tail = nonEmpty(colorName) ? SEPARATOR + colorName.trim() : "";
  return cleanText(head + tail);
}

// ---------------------------------------------------------------- contract
export function buildDisplayName(i: DisplayNameInput): DisplayNameResult {
  const reasons: string[] = [];
  const name = typeof i?.name === "string" ? i.name : "";

  let type = nonEmpty(i?.typeFa) ? i.typeFa.trim() : null;
  if (type === null) {
    type = typeFromName(name);
    if (type !== null) reasons.push("type-from-name");
  }

  if (!nonEmpty(i?.brandFa)) reasons.push("no-brand");
  if (type === null) reasons.push("no-type");
  if (!nonEmpty(i?.modelCode)) reasons.push("no-model");

  const brandFa = nonEmpty(i?.brandFa) ? i.brandFa.trim() : null;
  const modelCode = nonEmpty(i?.modelCode) ? i.modelCode.trim() : null;
  const colorName = nonEmpty(i?.colorName) ? i.colorName.trim() : null;

  let displayName = assemble(brandFa, type, modelCode, colorName);

  // Step 5 - shorten the TYPE word by word from the end; brand, model and colour are never cut.
  if (displayName.length > DISPLAY_NAME_MAX && type !== null) {
    let words = type.split(/\s+/).filter((w) => w !== "").length;
    while (displayName.length > DISPLAY_NAME_MAX && words > 0) {
      words -= 1;
      // truncateWords cuts at a word boundary and drops trailing punctuation; a name is not an
      // excerpt, so the ellipsis it appends is removed again (contract step 5: "no ellipsis").
      const shortened = words === 0 ? null : truncateWords(type, words).replace(ELLIPSIS_RE, "");
      displayName = assemble(brandFa, shortened, modelCode, colorName);
    }
    reasons.push("shortened");
  }

  // Step 6 - the colour is the last thing to go (the swatch already shows it).
  if (displayName.length > DISPLAY_NAME_MAX && colorName !== null) {
    displayName = assemble(brandFa, null, modelCode, null);
    reasons.push("colour-dropped");
  }

  return { displayName, draft: reasons.length > 0, reasons };
}

export function typeFromName(name: string): string | null {
  if (typeof name !== "string" || name.trim() === "") return null;
  let out = faNorm(name);
  MODEL_CODE_RE_G.lastIndex = 0;
  out = out.replace(MODEL_CODE_RE_G, " ");
  out = applyRules(out, BRAND_TOKEN_RULES);
  out = applyRules(out, COLOR_RULES);
  out = applyRules(out, NOISE_RULES);
  out = out.replace(LATIN_RUN_RE, " ").replace(/\s+/g, " ").trim();
  return out.length < MIN_TYPE_CHARS ? null : out;
}

export function nameLooksLikeScrape(name: string): boolean {
  if (typeof name !== "string" || name.trim() === "") return false;
  const normalized = faNorm(name);
  // 1. Latin-first name ("tefal masterchop xxl خردکن …").
  if (/^[a-z0-9]/u.test(normalized)) return true;
  // 2. A «رنگ X» tail ("… رنگ مشکی"). DECISION: the standalone word «رنگ» anywhere is the signal - 
  // the legacy scrape also writes it mid-name ("… رنگ ردولوت dyson hs08"), and a curated name
  // built by buildDisplayName never contains it (the colour sits after the separator).
  if (/(?:^| )رنگ(?: |$)/u.test(normalized)) return true;
  // 3. The same brand written twice, Persian and Latin ("خردکن تفال … tefal").
  const slugs = new Set<string>();
  for (const rule of BRAND_SLUG_RULES) {
    if (!rule.re.test(normalized)) continue;
    if (slugs.has(rule.slug)) return true;
    slugs.add(rule.slug);
  }
  return false;
}
