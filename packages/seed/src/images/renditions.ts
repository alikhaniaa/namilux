import sharp from "sharp";
import type { Sharp } from "sharp";
import { MAX_INPUT_PIXELS, assertDecodeBudget, configureSharpLimits, fitOutside } from "./limits.js";
import type { ObjectStore } from "./manifest.js";

export type Slot =
  | "product"
  | "hero_mobile"
  | "hero_desktop"
  | "band_mobile"
  | "band_desktop"
  | "category_tile"
  | "journal_cover"
  | "journal_inline"
  | "texture"
  | "og"
  | "brand_logo";

export const SLOTS: Record<
  Slot,
  { ratio: readonly [number, number] | null; master: number; widths: readonly number[]; crop: "normalized" | "cover" | "none"; note: string }
> = {
  product: { ratio: [4, 5], master: 1600, widths: [320, 480, 640, 960, 1280], crop: "normalized", note: "tile \u2264 960; gallery 640\u20131280 + master zoom" },
  hero_mobile: { ratio: [3, 4], master: 2400, widths: [640, 960, 1440, 1920, 2400], crop: "cover", note: "homepage hero, mobile crop" },
  hero_desktop: { ratio: [16, 9], master: 2400, widths: [640, 960, 1440, 1920, 2400], crop: "cover", note: "homepage hero, desktop crop" },
  band_mobile: { ratio: [4, 5], master: 2400, widths: [640, 1080, 1600, 2400], crop: "cover", note: "brand band, mobile" },
  band_desktop: { ratio: [21, 9], master: 2400, widths: [640, 1080, 1600, 2400], crop: "cover", note: "brand band, desktop" },
  category_tile: { ratio: [4, 5], master: 1400, widths: [320, 480, 720, 1000], crop: "cover", note: "collection tile; subject low, type space at top" },
  journal_cover: { ratio: [16, 9], master: 2000, widths: [480, 720, 1080, 1600, 2000], crop: "cover", note: "legacy covers centre-cropped" },
  journal_inline: { ratio: null, master: 1600, widths: [640, 960, 1280], crop: "none", note: "inline images keep their ratio" },
  texture: { ratio: [16, 9], master: 1800, widths: [640, 1080, 1800], crop: "cover", note: "empty states" },
  og: { ratio: [1200, 630], master: 1200, widths: [], crop: "none", note: "single JPEG from og-card.ts" },
  // 3 Sep 2026 (owner: "original logos of the companies"): a brand mark keeps its own ratio and its
  // transparency in the AVIF/WebP renditions (the JPEG master is flattened on white as every master is).
  brand_logo: { ratio: null, master: 1600, widths: [240, 480, 960], crop: "none", note: "brand mark; alpha kept in avif/webp" },
};

export const ENCODE = {
  avif: { quality: 55, effort: 4 },
  webp: { quality: 72 },
  masterJpeg: { quality: 90, mozjpeg: true },
} as const;

export const BUDGET_BYTES = {
  tileAvif480: 35 * 1024,
  heroAvifLargest: 180 * 1024,
} as const;

export type RenditionsJson = { avif: Record<string, string>; webp: Record<string, string>; master: string };

/** White ground, as an RGB object (the spec forbids hex literals outside tokens.css). */
const WHITE = { r: 255, g: 255, b: 255 } as const;

export function renditionKey(keyBase: string, w: number, ext: "avif" | "webp"): string {
  return `${keyBase}-${w}.${ext}`;
}

export function masterKeyFor(keyBase: string): string {
  return `${keyBase}.jpg`;
}

export function pickWidths(slot: Slot, masterWidth: number): number[] {
  const { widths } = SLOTS[slot];
  if (widths.length === 0) return [];
  const kept = widths.filter((w) => w <= masterWidth);
  const largest = widths[widths.length - 1] ?? 0;
  // Every slot keeps its top rendition: when the master is smaller than the widest listed width the
  // master width itself is emitted instead of upscaling (v1 ingest did the same).
  if (largest > masterWidth) kept.push(masterWidth);
  return [...new Set(kept)].filter((w) => w >= 1).sort((a, b) => a - b);
}

/** Largest width that can be cover-cropped to `ratio` out of `srcW x srcH` without upscaling. */
function maxCoverWidth(srcW: number, srcH: number, ratio: readonly [number, number]): number {
  return Math.max(1, Math.min(srcW, Math.floor((srcH * ratio[0]) / ratio[1])));
}

/**
 * Largest square box the decode may be shrunk into without changing a single emitted width.
 *
 * `fit: "outside"` only shrinks when both sides exceed the box and leaves both sides >= the box, so
 * a cap of `master` (width-bound slots) or `master * height/width` (cover slots, whose master width
 * is limited by the source *height*) leaves `masterWidth` and every rendition width exactly where
 * they were. Sources below the cap \u2014 which includes every normalized 1600x2000 product plate in the
 * catalogue \u2014 are not resampled at all, so existing catalogue bytes are unchanged.
 */
export function decodeCapFor(slot: Slot): number {
  const def = SLOTS[slot];
  if (def.crop !== "cover" || def.ratio === null) return def.master;
  return Math.ceil(def.master * Math.max(1, def.ratio[1] / def.ratio[0]));
}

export async function emitRenditions(
  master: Buffer,
  slot: Slot,
  keyBase: string,
  store: ObjectStore,
  opts: { signal?: AbortSignal } = {},
): Promise<{ renditions: RenditionsJson; bytes: Record<string, number>; overBudget: string[]; width: number; height: number }> {
  configureSharpLimits();
  const def = SLOTS[slot];
  const cover = def.crop === "cover" && def.ratio !== null;
  const { signal } = opts;
  signal?.throwIfAborted();

  // Decode once into raw pixels: every output resizes from the same buffer instead of re-decoding.
  // Alpha is flattened on white here (05 \u00a76: stored bytes are never the uploaded bytes, and a
  // normalized master must never carry alpha).
  // brand_logo is the one slot whose delivery renditions keep alpha (a mark sits on any tile ground).
  const keepAlpha = slot === "brand_logo";
  const cap = decodeCapFor(slot);
  // The raw buffer is the single largest allocation in the worker, so its size is decided (and
  // refused) from the header before libvips touches a pixel.
  const meta = await sharp(master, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  const projected = fitOutside(meta.width ?? 0, meta.height ?? 0, cap);
  assertDecodeBudget(projected.width, projected.height, keepAlpha ? 4 : 3, `emitRenditions(${slot})`);

  const input = sharp(master, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const decoded = await (keepAlpha ? input.ensureAlpha() : input.flatten({ background: WHITE }).removeAlpha())
    .resize({ width: cap, height: cap, fit: "outside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const srcW = decoded.info.width;
  const srcH = decoded.info.height;
  const raw = { width: srcW, height: srcH, channels: decoded.info.channels };
  const from = (): Sharp => sharp(decoded.data, { raw });

  const masterWidth = cover && def.ratio ? Math.min(def.master, maxCoverWidth(srcW, srcH, def.ratio)) : Math.min(def.master, srcW);
  // DECISION: the emitted dimensions are computed arithmetically (sharp preserves the ratio with the
  // same rounding) rather than read back from an encode, so the idempotent path - where nothing is
  // encoded because every key is already in the store - still reports width/height for the media row.
  const heightFor = (w: number): number =>
    cover && def.ratio ? Math.round((w * def.ratio[1]) / def.ratio[0]) : Math.round((srcH * w) / srcW);
  const masterHeight = heightFor(masterWidth);

  const resized = (w: number): Sharp =>
    cover
      ? from().resize(w, heightFor(w), { fit: "cover", position: "centre" })
      : from().resize({ width: w, withoutEnlargement: true });

  const bytes: Record<string, number> = {};
  const renditions: RenditionsJson = { avif: {}, webp: {}, master: masterKeyFor(keyBase) };

  const emit = async (key: string, mime: string, encode: () => Promise<Buffer>): Promise<void> => {
    // Renditions are encoded one after another, so the gap between two encodes is the checkpoint
    // where an aborted job (timeout or shutdown) stops allocating instead of running to the end.
    signal?.throwIfAborted();
    // Content-hashed keyBase: an existing key holds these exact bytes, so encoding again is waste.
    const existing = await store.stat(key);
    if (existing) {
      bytes[key] = existing.bytes;
      return;
    }
    const buf = await encode();
    const put = await store.put(key, buf, mime);
    bytes[key] = put.bytes;
  };

  await emit(renditions.master, "image/jpeg", async () =>
    resized(masterWidth)
      // JPEG has no alpha: the brand_logo master lands on white like every other master.
      .flatten({ background: WHITE })
      .jpeg({ quality: ENCODE.masterJpeg.quality, mozjpeg: ENCODE.masterJpeg.mozjpeg })
      .toBuffer(),
  );

  for (const w of pickWidths(slot, masterWidth)) {
    // AVIF first: `renditions_json` order is the order the web <picture> lists sources in (02 \u00a72).
    const avifKey = renditionKey(keyBase, w, "avif");
    await emit(avifKey, "image/avif", async () =>
      resized(w).avif({ quality: ENCODE.avif.quality, effort: ENCODE.avif.effort }).toBuffer(),
    );
    renditions.avif[String(w)] = avifKey;

    const webpKey = renditionKey(keyBase, w, "webp");
    await emit(webpKey, "image/webp", async () => resized(w).webp({ quality: ENCODE.webp.quality }).toBuffer());
    renditions.webp[String(w)] = webpKey;
  }

  const overBudget: string[] = [];
  if (slot === "product") {
    const tile = renditions.avif["480"];
    const size = tile === undefined ? undefined : bytes[tile];
    if (tile !== undefined && size !== undefined && size > BUDGET_BYTES.tileAvif480) overBudget.push(tile);
  } else if (slot === "hero_mobile" || slot === "hero_desktop") {
    const widths = Object.keys(renditions.avif).map(Number);
    const largest = widths.length ? Math.max(...widths) : null;
    const key = largest === null ? undefined : renditions.avif[String(largest)];
    const size = key === undefined ? undefined : bytes[key];
    if (key !== undefined && size !== undefined && size > BUDGET_BYTES.heroAvifLargest) overBudget.push(key);
  }

  return { renditions, bytes, overBudget, width: masterWidth, height: masterHeight };
}
