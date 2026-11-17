import sharp from "sharp";
import { MAX_INPUT_PIXELS } from "./limits.js";

export const QUARANTINE = {
  MIN_AR: 0.5,
  MAX_AR: 2.0,
  MAX_BBOX_AREA: 0.94,
  EDGE_SATURATION: 0.04,
  EDGE_FRAC: 0.06,
  SAMPLE_PX: 120,
} as const;

export type QuarantineRecord = {
  productId: number;
  n: number;
  sourceFile: string;
  reasons: string[];
  metrics: { srcAspect: number; bboxArea: number; edgeSat: number };
};

/** White ground, as an RGB object (the spec forbids hex literals outside tokens.css). */
const WHITE = { r: 255, g: 255, b: 255 } as const;

export async function edgeSaturation(input: Buffer, frac: number = QUARANTINE.EDGE_FRAC): Promise<number> {
  // DECISION: flatten on white before sampling. v1 sampled the raw file; a PNG cut-out then reports
  // the undefined RGB under fully transparent pixels as "colour". Flattening is a no-op for the
  // opaque JPEG/WebP sources that produced the calibration numbers, and it matches what
  // normalize.ts actually composites, so the measurement describes the image we ship.
  const { data, info } = await sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
    .flatten({ background: WHITE })
    .resize(QUARANTINE.SAMPLE_PX, QUARANTINE.SAMPLE_PX, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: W, height: H, channels: C } = info;
  const border = Math.max(1, Math.round(W * frac));
  let sum = 0;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inBorder = x < border || x >= W - border || y < border || y >= H - border;
      if (!inBorder) continue;
      const p = (y * W + x) * C;
      const r = data[p] ?? 0;
      const g = data[p + 1] ?? 0;
      const b = data[p + 2] ?? 0;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      sum += mx === 0 ? 0 : (mx - mn) / mx;
      n++;
    }
  }
  return n ? sum / n : 0;
}

export function quarantineReasons(m: {
  srcAspect: number;
  bboxArea: number;
  edgeSat: number;
  bboxW?: number;
  bboxH?: number;
}): string[] {
  const reasons: string[] = [];
  if (m.srcAspect < QUARANTINE.MIN_AR || m.srcAspect > QUARANTINE.MAX_AR) {
    // eslint-disable-next-line namilux/no-locale-number -- seed report diagnostics (stdout/CSV), never UI copy
    reasons.push(`aspect ${m.srcAspect.toFixed(2)}`);
  }
  // A LARGE bbox is the bad case: trim() found no white margin, so the frame is full-bleed.
  // Never invert this (v2 §5.1: the inverted first draft flagged 38 good pack shots).
  if (m.bboxArea > QUARANTINE.MAX_BBOX_AREA) {
    // eslint-disable-next-line namilux/no-locale-number -- seed report diagnostics (stdout/CSV), never UI copy
    reasons.push(`full-bleed frame (bbox ${(m.bboxArea * 100).toFixed(0)}%)`);
  }
  if (m.edgeSat > QUARANTINE.EDGE_SATURATION) {
    // eslint-disable-next-line namilux/no-locale-number -- seed report diagnostics (stdout/CSV), never UI copy
    reasons.push(`coloured border (sat ${m.edgeSat.toFixed(3)})`);
  }
  if ((m.bboxW !== undefined && m.bboxW <= 1) || (m.bboxH !== undefined && m.bboxH <= 1)) {
    reasons.push("empty after trim");
  }
  return reasons;
}

export function isPrimaryEligible(r: { quarantined: boolean; failed: boolean; exists: boolean }): boolean {
  return r.exists && !r.failed && !r.quarantined;
}

export function chooseRoles(
  images: { n: number; exists: boolean; quarantined: boolean; failed: boolean }[],
): { n: number; role: "primary" | "gallery"; sort: number }[] {
  // Quarantine is metadata, not deletion: quarantined images still ship as gallery (v2 §5.1).
  // Missing and failed images have no bytes to ship, so they are excluded entirely.
  const usable = images.filter((i) => i.exists && !i.failed).sort((a, b) => a.n - b.n);
  const primary = usable.find((i) => isPrimaryEligible(i));
  const out: { n: number; role: "primary" | "gallery"; sort: number }[] = [];
  let sort = 1;
  for (const img of usable) {
    if (primary && img.n === primary.n) {
      out.push({ n: img.n, role: "primary", sort: 0 });
      continue;
    }
    // DECISION: gallery sort always starts at 1, including when there is no eligible primary - 
    // sort 0 stays reserved for the primary so the caller can detect "no primary" by its absence.
    out.push({ n: img.n, role: "gallery", sort });
    sort++;
  }
  return out.sort((a, b) => a.sort - b.sort);
}
