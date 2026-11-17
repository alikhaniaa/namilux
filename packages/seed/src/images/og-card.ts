import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { z } from "zod";
// DECISION: the `@namilux/core/persian` subpath instead of the package barrel (same package, same
// functions) - the barrel evaluates unrelated modules at load time, which would couple the seed
// media stage to every other core module being finished first. Precedent: src/idempotency.ts.
import { truncateWords, faDigits, splitLatinRuns } from "@namilux/core/persian";
import tokens from "@namilux/tokens/tokens.json" with { type: "json" };
import { MAX_INPUT_PIXELS, configureSharpLimits } from "./limits.js";
import { ogKeyFor } from "./manifest.js";

export const OG = {
  W: 1200,
  H: 630,
  plinth: { w: 800, h: 510, top: 40 },
  product: { w: 760, h: 470, top: 60 },
  label: { y: 596, size: 34, sizeNoImage: 52, yNoImage: 330, maxChars: 60, weight: 700 },
  mark: { wordmark: "\u0646\u0627\u0645\u06cc\u200c\u0644\u0648\u06a9\u0633", size: 28, squareEm: 0.28, gapEm: 0.18, x: 1200 - 60, y: 60 },
  jpegQuality: 84,
  fontFamily: "Estedad, Vazirmatn, 'Segoe UI', Tahoma, sans-serif",
} as const;

export type OgKind = "product" | "brand" | "collection" | "site";
export type OgCardInput = { kind: OgKind; label: string; image?: Buffer | null };
export type OgColors = { bg: string; surface: string; ink: string; ink3: string; accent: string };

export const SITE_OG_LABEL = "\u0646\u0627\u0645\u06cc\u200c\u0644\u0648\u06a9\u0633 \u2014 \u0644\u0648\u0627\u0632\u0645 \u062e\u0627\u0646\u06af\u06cc \u0644\u0648\u06a9\u0633";

/** Shape we require from tokens.json (light theme). Validated at runtime; the tokens package owns the values. */
export const ogTokenSchema = z.object({
  bg: z.string().min(4),
  surface: z.string().min(4),
  ink: z.string().min(4),
  "ink-3": z.string().min(4),
  accent: z.string().min(4),
});

/**
 * DECISION: SVG gives no text-measurement API in this pipeline, so the accent square is placed at a
 * measured advance estimate for the wordmark (em multiples of the mark font size) rather than at the
 * true end of the shaped run. Deliberately generous: an estimate that is too wide leaves a little
 * extra air, one that is too narrow would overlap the type. Cosmetic on a 1200x630 card.
 */
const MARK_WORDMARK_EM = 5.4;

/** White ground for the product plate (12 \u00a76 forbids hex literals outside tokens.css). */
const WHITE = { r: 255, g: 255, b: 255 } as const;

export function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function ogColorsFromTokens(input: unknown): OgColors {
  // tokens.json is `{ meta, themes: { light, dark } }`; a bare light-theme object is accepted too so
  // tests and the worker can pass either.
  const themed = z.object({ themes: z.object({ light: z.unknown() }) }).safeParse(input);
  const light: unknown = themed.success ? themed.data.themes.light : input;
  const parsed = ogTokenSchema.safeParse(light);
  if (!parsed.success) {
    // Fail loudly: shipping an OG card in the wrong colours is worse than not shipping one (12 \u00a710).
    throw new Error("tokens.json is missing an OG colour (bg, surface, ink, ink-3, accent)");
  }
  return {
    bg: parsed.data.bg,
    surface: parsed.data.surface,
    ink: parsed.data.ink,
    ink3: parsed.data["ink-3"],
    accent: parsed.data.accent,
  };
}

/** Word-boundary truncation to the character budget (truncateWords counts words, the card counts chars). */
function fitLabel(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= OG.label.maxChars) return trimmed;
  const words = trimmed.split(/\s+/).length;
  for (let n = words - 1; n >= 1; n--) {
    const candidate = truncateWords(trimmed, n);
    if (candidate.length <= OG.label.maxChars) return candidate;
  }
  // A single word longer than the budget: never cut mid-word (the header is explicit), so it stays.
  return truncateWords(trimmed, 1);
}

export function ogSvgOverlay(i: { label: string; withImage: boolean; colors: OgColors }): string {
  // Persian digits, but Latin model designators keep theirs (12 \u00a711 rule 2 - faDigits guard).
  const label = fitLabel(faDigits(i.label, true));
  const y = i.withImage ? OG.label.y : OG.label.yNoImage;
  const size = i.withImage ? OG.label.size : OG.label.sizeNoImage;
  // Latin runs are isolated so a model code does not reorder the Persian around it.
  const runs = splitLatinRuns(label)
    .map((r) =>
      r.latin
        ? `<tspan direction="ltr" unicode-bidi="isolate">${escapeSvgText(r.text)}</tspan>`
        : escapeSvgText(r.text),
    )
    .join("");
  const squareSide = OG.mark.size * OG.mark.squareEm;
  const gap = OG.mark.size * OG.mark.gapEm;
  // The square sits after the wordmark on the baseline (04 \u00a76) - in RTL that is to its left.
  const squareRight = OG.mark.x - OG.mark.size * MARK_WORDMARK_EM - gap;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.W}" height="${OG.H}">` +
    `<text x="${OG.W / 2}" y="${y}" text-anchor="middle" direction="rtl" xml:space="preserve" ` +
    `font-family="${OG.fontFamily}" font-size="${size}" font-weight="${OG.label.weight}" fill="${i.colors.ink}">${runs}</text>` +
    `<text x="${OG.mark.x}" y="${OG.mark.y}" text-anchor="end" ` +
    `font-family="${OG.fontFamily}" font-size="${OG.mark.size}" font-weight="${OG.label.weight}" ` +
    `fill="${i.colors.ink}">${escapeSvgText(OG.mark.wordmark)}</text>` +
    `<rect x="${squareRight - squareSide}" y="${OG.mark.y - squareSide}" width="${squareSide}" height="${squareSide}" ` +
    `fill="${i.colors.accent}"/>` +
    `</svg>`
  );
}

export function ogKey(kind: OgKind, id: string | number): string {
  // Single source for the key layout: manifest.ts owns it (the store validates every key).
  const map = { product: "p", brand: "b", collection: "c", site: "site" } as const;
  return ogKeyFor(map[kind], id);
}

export async function ogCard(i: OgCardInput): Promise<Buffer> {
  configureSharpLimits();
  const colors = ogColorsFromTokens(tokens);
  const image = i.image ?? null;
  const withImage = image !== null && image.length > 0;
  const layers: OverlayOptions[] = [];

  if (withImage && image) {
    const plinth = await sharp({
      create: { width: OG.plinth.w, height: OG.plinth.h, channels: 3, background: colors.surface },
    })
      .png()
      .toBuffer();
    const product = await sharp(image, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .flatten({ background: WHITE })
      .removeAlpha()
      // withoutEnlargement: a small legacy source is centred on the plinth rather than blown up.
      .resize({ width: OG.product.w, height: OG.product.h, fit: "contain", background: WHITE, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    layers.push({ input: plinth, left: Math.round((OG.W - OG.plinth.w) / 2), top: OG.plinth.top });
    layers.push({
      input: product.data,
      left: Math.round((OG.W - product.info.width) / 2),
      top: OG.product.top + Math.round((OG.product.h - product.info.height) / 2),
    });
  }

  layers.push({ input: Buffer.from(ogSvgOverlay({ label: i.label, withImage, colors })), left: 0, top: 0 });

  return sharp({ create: { width: OG.W, height: OG.H, channels: 3, background: colors.bg } })
    .composite(layers)
    .jpeg({ quality: OG.jpegQuality })
    .toBuffer();
}
