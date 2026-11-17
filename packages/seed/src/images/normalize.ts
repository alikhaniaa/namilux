import sharp from "sharp";
import { MAX_INPUT_PIXELS, assertDecodeBudget, configureSharpLimits } from "./limits.js";
import { quarantineReasons, edgeSaturation } from "./quarantine.js";

export const CANVAS = { W: 1600, H: 2000 } as const;
export const SUBJECT_H = 0.66;
export const WIDTH_CAP = 0.86;
export const BASELINE = 0.82;
export const TRIM_THRESHOLD = 12;
export const GROUND = { r: 255, g: 255, b: 255 } as const;
export const SHADOW = {
  widthRatio: 0.72,
  heightRatio: 0.045,
  minHeightPx: 8,
  opacity: 0.3,
  fill: { r: 107, g: 98, b: 90 },
  footOverlap: 0.6,
  minBlur: 1.5,
} as const;
export const AT_TARGET_TOLERANCE = 0.005;
/** A scale above this means the source was tiny; the image is kept but reported (soft result). */
export const SOFT_SCALE_WARNING = 2.5;

export type NormalizeMetrics = {
  srcW: number;
  srcH: number;
  srcAspect: number;
  bboxW: number;
  bboxH: number;
  bboxArea: number;
  edgeSat: number;
  scale: number;
  subjectH: number;
  subjectW: number;
  widthBound: boolean;
};

export type NormalizeResult =
  | { status: "ok"; master: Buffer; metrics: NormalizeMetrics }
  | { status: "quarantine"; reasons: string[]; metrics: NormalizeMetrics };

/** 4 decimals, as v1 recorded them - keeps the manifest byte-stable between runs. */
function r4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export async function measureSubject(
  input: Buffer,
): Promise<{ trimmed: Buffer; srcW: number; srcH: number; bboxW: number; bboxH: number }> {
  configureSharpLimits();
  // The subject is measured at full resolution on purpose - the bbox ratio and the quarantine
  // decision are calibrated against the source pixels - so the only safe guard here is to refuse a
  // source that cannot be held, before libvips allocates it. Renditions shrink on decode instead.
  const probe = await sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  assertDecodeBudget(probe.width ?? 0, probe.height ?? 0, 3, "normalizeImage");
  // EXIF orientation is applied before anything is measured, so srcAspect and the bbox describe the
  // image as a human sees it. Metadata never survives this step.
  const flat = await sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: GROUND })
    .removeAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });
  const srcW = flat.info.width;
  const srcH = flat.info.height;
  try {
    const trimmed = await sharp(flat.data)
      .trim({ threshold: TRIM_THRESHOLD })
      .png()
      .toBuffer({ resolveWithObject: true });
    return { trimmed: trimmed.data, srcW, srcH, bboxW: trimmed.info.width, bboxH: trimmed.info.height };
  } catch {
    // DECISION: a trim that throws (uniform image, nothing to keep) is reported as a 1x1 bbox rather
    // than propagating - quarantineReasons turns that into "empty after trim" and the caller
    // quarantines instead of failing the whole product. Note that sharp 0.35 usually returns the
    // image untouched for a uniform input, which quarantines via bbox 100 % instead; both land in
    // quarantine, which is the contract.
    return { trimmed: flat.data, srcW, srcH, bboxW: 1, bboxH: 1 };
  }
}

export function placeSubject(
  bboxW: number,
  bboxH: number,
): { scale: number; w1: number; h1: number; left: number; top: number; widthBound: boolean } {
  // DECISION: a non-positive bbox (only reachable from the "empty after trim" path, which is
  // quarantined anyway) is clamped to 1 px so the arithmetic stays finite instead of dividing by 0.
  const w0 = Math.max(1, bboxW);
  const h0 = Math.max(1, bboxH);
  let scale = (SUBJECT_H * CANVAS.H) / h0;
  let widthBound = false;
  if (w0 * scale > WIDTH_CAP * CANVAS.W) {
    scale = (WIDTH_CAP * CANVAS.W) / w0;
    widthBound = true;
  }
  const w1 = Math.max(1, Math.round(w0 * scale));
  const h1 = Math.max(1, Math.round(h0 * scale));
  // Centre horizontally; foot on the shared baseline. Both are inside the canvas by construction:
  // w1 <= 0.86 * W and h1 <= 0.66 * H < 0.82 * H.
  const left = Math.round((CANVAS.W - w1) / 2);
  const top = Math.round(BASELINE * CANVAS.H - h1);
  return { scale, w1, h1, left, top, widthBound };
}

export function shadowSvg(
  w1: number,
  h1: number,
): { svg: string; width: number; height: number; blur: number; left: number; topFromSubjectBottom: number } {
  const width = Math.max(1, Math.round(w1 * SHADOW.widthRatio));
  const height = Math.max(SHADOW.minHeightPx, Math.round(h1 * SHADOW.heightRatio));
  const blur = Math.max(SHADOW.minBlur, height / 2);
  const left = Math.round((CANVAS.W - width) / 2);
  // DECISION: signed offset from the subject's bottom edge (negative = the ellipse sits under the
  // foot). Callers do `top = subjectTop + subjectHeight + topFromSubjectBottom`, as v1 did inline.
  const topFromSubjectBottom = -Math.round(height * SHADOW.footOverlap);
  const { r, g, b } = SHADOW.fill;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" ` +
    // eslint-disable-next-line namilux/no-raw-color -- SHADOW.fill is a sharp compositing value (v2 §5.1), not a UI colour
    `fill="rgb(${r},${g},${b})" opacity="${SHADOW.opacity}"/></svg>`;
  return { svg, width, height, blur, left, topFromSubjectBottom };
}

export async function normalizeImage(input: Buffer): Promise<NormalizeResult> {
  const { trimmed, srcW, srcH, bboxW, bboxH } = await measureSubject(input);
  const edgeSat = await edgeSaturation(input);
  const place = placeSubject(bboxW, bboxH);

  const metrics: NormalizeMetrics = {
    srcW,
    srcH,
    srcAspect: r4(srcW / srcH),
    bboxW,
    bboxH,
    bboxArea: r4((bboxW * bboxH) / Math.max(1, srcW * srcH)),
    edgeSat: r4(edgeSat),
    scale: r4(place.scale),
    subjectH: r4(place.h1 / CANVAS.H),
    subjectW: r4(place.w1 / CANVAS.W),
    widthBound: place.widthBound,
  };

  // The classifier reads the same rounded numbers the manifest stores, so a QA reviewer can redo
  // the decision by hand from the manifest.
  const reasons = quarantineReasons(metrics);
  if (reasons.length) return { status: "quarantine", reasons, metrics };

  const subject = await sharp(trimmed).resize(place.w1, place.h1).removeAlpha().toBuffer();
  const shadow = shadowSvg(place.w1, place.h1);
  const shadowLayer = await sharp(Buffer.from(shadow.svg)).blur(shadow.blur).png().toBuffer();
  const shadowTop = Math.max(
    0,
    Math.min(CANVAS.H - shadow.height, place.top + place.h1 + shadow.topFromSubjectBottom),
  );

  const master = await sharp({
    create: { width: CANVAS.W, height: CANVAS.H, channels: 3, background: GROUND },
  })
    .composite([
      { input: shadowLayer, left: shadow.left, top: shadowTop },
      { input: subject, left: place.left, top: place.top },
    ])
    // Ground stays opaque white: `.plate img { mix-blend-mode: multiply }` composites it (v2 §5.1).
    // Compositing an alpha layer would otherwise leave the master RGBA.
    .removeAlpha()
    .png()
    .toBuffer();

  return { status: "ok", master, metrics };
}

export function normalizeJson(
  m: NormalizeMetrics,
  quarantined: boolean,
  reasons: string[],
): {
  subjectH: number;
  subjectW: number;
  widthBound: boolean;
  quarantined: boolean;
  reason: string | null;
  bbox: number;
  edgeSat: number;
  scale: number;
} {
  return {
    subjectH: m.subjectH,
    subjectW: m.subjectW,
    widthBound: m.widthBound,
    quarantined,
    // DECISION: the spec types `reason` as a single field; multiple reasons join with "; " so the admin
    // QA view (A-015) shows every signal that fired, not just the first.
    reason: reasons.length ? reasons.join("; ") : null,
    bbox: m.bboxArea,
    edgeSat: m.edgeSat,
    scale: m.scale,
  };
}
