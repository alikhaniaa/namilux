import sharp from "sharp";

/**
 * Memory guards for every sharp pipeline in this package.
 *
 * The 20 Sep 2026 audit (docs/ops/2026-09-20-efficiency-audit.md §5) found that a compressed
 * file-size cap bounds nothing: `emitRenditions` decodes the whole source to raw pixels, and a
 * 10,000 x 10,000 RGB source is ~286 MiB of raw buffer on a 3.9 GiB box that also runs two Next
 * processes. libvips adds its own per-pipeline threads and a page cache on top of that.
 *
 * Three separate limits, because they fail in three different ways:
 *   - `MAX_INPUT_PIXELS` stops a decompression bomb inside libvips, before any pixel is allocated;
 *   - the decode budget stops a merely enormous (but honest) photograph, in JS, with a message an
 *     operator can read, so the job dies instead of the process;
 *   - the cache/concurrency settings bound what libvips retains and forks *between* jobs.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** Megapixels libvips will decode at all. A 60 MP camera file passes; a 30,000 px PNG bomb does not. */
export const MAX_INPUT_PIXELS = envInt("MEDIA_MAX_INPUT_MP", 80) * 1_000_000;
/** Ceiling on one decoded raw buffer. Reached only by pathological aspect ratios, not by photographs. */
export const MAX_DECODED_BYTES = envInt("MEDIA_MAX_DECODED_MB", 96) * 1024 * 1024;
/**
 * libvips operation cache. sharp's default (50 MB / 20 files / 200 items) is sized for a server that
 * re-renders the same images; this worker sees each source once, so the cache is nearly pure
 * retention. `files: 0` also stops it holding file descriptors open between jobs.
 */
export const SHARP_CACHE = { memory: envInt("SHARP_CACHE_MB", 16), files: 0, items: 50 } as const;
/**
 * One libvips worker thread per pipeline. The default is one per CPU, and each thread carries its own
 * tile buffers - on a 2 vCPU box that doubles peak footprint to halve the wall-clock of a job that is
 * already off the request path. The runtime runs one media job at a time, so throughput is unaffected.
 */
export const SHARP_CONCURRENCY = envInt("SHARP_CONCURRENCY", 1);

let applied = false;

/** Idempotent; every entry point in this package calls it before building a pipeline. */
export function configureSharpLimits(): void {
  if (applied) return;
  applied = true;
  sharp.cache({ memory: SHARP_CACHE.memory, files: SHARP_CACHE.files, items: SHARP_CACHE.items });
  sharp.concurrency(SHARP_CONCURRENCY);
}

/** Test seam: forget that the limits were applied so a test can observe them being set again. */
export function resetSharpLimitsForTest(): void {
  applied = false;
}

/**
 * The dimensions sharp produces for `fit: "outside"` + `withoutEnlargement`: scale so the image
 * covers the box, never upwards. Shrinking only ever happens when BOTH sides exceed `cap`, and the
 * result still has both sides >= `cap` - which is what lets the caller cap a decode without changing
 * any emitted width (see renditions.ts).
 */
export function fitOutside(srcW: number, srcH: number, cap: number): { width: number; height: number } {
  const w = Math.max(1, Math.trunc(srcW));
  const h = Math.max(1, Math.trunc(srcH));
  const scale = Math.max(cap / w, cap / h);
  if (scale >= 1) return { width: w, height: h };
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function decodedBytes(width: number, height: number, channels: number): number {
  return Math.max(0, Math.trunc(width)) * Math.max(0, Math.trunc(height)) * Math.max(1, Math.trunc(channels));
}

/**
 * Refuse a decode that would not fit the budget. Throws before the allocation, so the caller fails
 * one job with a legible reason rather than taking the worker down with it.
 */
export function assertDecodeBudget(width: number, height: number, channels: number, label: string): void {
  const bytes = decodedBytes(width, height, channels);
  if (bytes <= MAX_DECODED_BYTES) return;
  // eslint-disable-next-line namilux/no-locale-number -- Machine decoder diagnostic, not storefront copy.
  const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
  throw new Error(
    `${label}: decoding ${width}x${height} needs ${mb(bytes)} MB of raw pixels, over the ${mb(MAX_DECODED_BYTES)} MB budget`,
  );
}
