import sharp from "sharp";
import { MAX_INPUT_PIXELS, configureSharpLimits } from "./limits.js";

export const LQIP = {
  width: 20,
  quality: 38,
  blur: 1,
  maxBytes: 400,
  fallback: { width: 16, quality: 30 },
  mime: "image/webp",
} as const;

/** White ground, as an RGB object (the spec forbids hex literals outside tokens.css). */
const WHITE = { r: 255, g: 255, b: 255 } as const;

const PREFIX = `data:${LQIP.mime};base64,`;

async function encode(master: Buffer, width: number, quality: number): Promise<string> {
  configureSharpLimits();
  const buf = await sharp(master, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: WHITE })
    .removeAlpha()
    .resize({ width, withoutEnlargement: true })
    .blur(LQIP.blur)
    .webp({ quality })
    .toBuffer();
  return PREFIX + buf.toString("base64");
}

export function lqipBytes(dataUri: string): number {
  return Buffer.byteLength(dataUri, "utf8");
}

export async function lqip(master: Buffer): Promise<string> {
  const first = await encode(master, LQIP.width, LQIP.quality);
  if (lqipBytes(first) <= LQIP.maxBytes) return first;
  const second = await encode(master, LQIP.fallback.width, LQIP.fallback.quality);
  if (lqipBytes(second) <= LQIP.maxBytes) return second;
  // The importer catches this, records the failure and stores lqip NULL: a missing placeholder is a
  // cosmetic loss, an oversized one would breach the media.lqip contract.
  throw new Error("lqip exceeds 400 B");
}
