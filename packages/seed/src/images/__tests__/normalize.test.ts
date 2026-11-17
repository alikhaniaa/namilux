import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AT_TARGET_TOLERANCE,
  BASELINE,
  CANVAS,
  SUBJECT_H,
  WIDTH_CAP,
  normalizeImage,
  normalizeJson,
  measureSubject,
  placeSubject,
  shadowSvg,
} from "../normalize.js";

const WHITE = { r: 255, g: 255, b: 255 } as const;
const INK = { r: 24, g: 26, b: 28 } as const;

/** A pack shot: a dark rectangle centred on a white frame. */
async function packShot(
  frameW: number,
  frameH: number,
  subjW: number,
  subjH: number,
  fill: { r: number; g: number; b: number } = INK,
  ground: { r: number; g: number; b: number } = WHITE,
): Promise<Buffer> {
  const subject = await sharp({ create: { width: subjW, height: subjH, channels: 3, background: fill } })
    .png()
    .toBuffer();
  return sharp({ create: { width: frameW, height: frameH, channels: 3, background: ground } })
    .composite([{ input: subject, left: Math.round((frameW - subjW) / 2), top: Math.round((frameH - subjH) / 2) }])
    .png()
    .toBuffer();
}

/** Pixel at (x, y) of a PNG buffer. */
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const p = (y * info.width + x) * info.channels;
  return [data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0];
}

describe("placeSubject", () => {
  it("scales a portrait subject to 66 % of the canvas height and puts its foot on the 82 % baseline", () => {
    const p = placeSubject(300, 600);
    expect(p.widthBound).toBe(false);
    expect(p.h1).toBe(Math.round(SUBJECT_H * CANVAS.H));
    expect(p.top + p.h1).toBe(Math.round(BASELINE * CANVAS.H));
    expect(p.left).toBe(Math.round((CANVAS.W - p.w1) / 2));
  });

  it("clamps a landscape subject at the 86 % width cap and renders it shorter", () => {
    const p = placeSubject(1800, 1000); // aspect 1.8 - the widest real subject (v2 §5.1)
    expect(p.widthBound).toBe(true);
    expect(p.w1).toBe(Math.round(WIDTH_CAP * CANVAS.W));
    expect(p.h1 / CANVAS.H).toBeLessThan(SUBJECT_H);
    expect(p.top + p.h1).toBe(Math.round(BASELINE * CANVAS.H));
  });

  it("never divides by zero on an empty bbox", () => {
    const p = placeSubject(0, 0);
    expect(Number.isFinite(p.scale)).toBe(true);
    expect(p.w1).toBeGreaterThanOrEqual(1);
  });
});

describe("shadowSvg", () => {
  it("is a contact ellipse 72 % of the subject width, lifted under the foot", () => {
    const s = shadowSvg(1000, 1200);
    expect(s.width).toBe(720);
    expect(s.height).toBe(54);
    expect(s.blur).toBe(27);
    expect(s.left).toBe(Math.round((CANVAS.W - s.width) / 2));
    expect(s.topFromSubjectBottom).toBe(-32);
    expect(s.svg).toContain("<ellipse");
    expect(s.svg).toContain('fill="rgb(107,98,90)"');
    expect(s.svg).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("keeps a minimum height and blur for a tiny subject", () => {
    const s = shadowSvg(20, 20);
    expect(s.height).toBe(8);
    expect(s.blur).toBe(4);
  });
});

describe("measureSubject", () => {
  it("trims the white margin down to the subject bbox", async () => {
    const m = await measureSubject(await packShot(800, 1000, 300, 600));
    expect([m.srcW, m.srcH]).toEqual([800, 1000]);
    expect(m.bboxW).toBe(300);
    expect(m.bboxH).toBe(600);
  });

  it("flattens an alpha cut-out on white before trimming", async () => {
    const subject = await sharp({ create: { width: 200, height: 400, channels: 3, background: INK } })
      .png()
      .toBuffer();
    const cutout = await sharp({
      create: { width: 800, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: subject, left: 300, top: 300 }])
      .png()
      .toBuffer();
    const m = await measureSubject(cutout);
    expect(m.bboxW).toBe(200);
    expect(m.bboxH).toBe(400);
  });

  it("applies EXIF orientation before measuring", async () => {
    const upright = await packShot(800, 1000, 300, 600);
    const rotated = await sharp(upright).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const m = await measureSubject(rotated);
    // orientation 6 = rotate 90°: the source now reads as landscape
    expect(m.srcW).toBe(1000);
    expect(m.srcH).toBe(800);
    expect(m.bboxW).toBe(600);
    expect(m.bboxH).toBe(300);
  });
});

describe("normalizeImage", () => {
  it("puts an ok subject at 66 % ± 0.005 on an exact 1600×2000 opaque master", async () => {
    const r = await normalizeImage(await packShot(800, 1000, 300, 600));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(Math.abs(r.metrics.subjectH - SUBJECT_H)).toBeLessThan(AT_TARGET_TOLERANCE);
    expect(r.metrics.subjectH).toBeGreaterThanOrEqual(0.655);
    expect(r.metrics.subjectH).toBeLessThanOrEqual(0.665);
    expect(r.metrics.widthBound).toBe(false);

    const meta = await sharp(r.master).metadata();
    expect([meta.width, meta.height]).toEqual([CANVAS.W, CANVAS.H]);
    expect(meta.channels).toBe(3);
    expect(meta.hasAlpha).toBe(false);
    expect(meta.format).toBe("png");
  });

  it("stands the subject on the 82 % baseline with white above and below", async () => {
    const r = await normalizeImage(await packShot(800, 1000, 300, 600));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const baseline = Math.round(BASELINE * CANVAS.H);
    const [ar] = await pixel(r.master, CANVAS.W / 2, baseline - 20); // inside the subject
    const [br] = await pixel(r.master, CANVAS.W / 2, Math.round(baseline - SUBJECT_H * CANVAS.H) - 40); // above it
    expect(ar).toBeLessThan(80);
    expect(br).toBeGreaterThan(240);
  });

  it("marks a landscape subject width-bound and shorter than 66 %", async () => {
    const r = await normalizeImage(await packShot(1200, 800, 900, 500));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.metrics.widthBound).toBe(true);
    expect(r.metrics.subjectW).toBeCloseTo(WIDTH_CAP, 2);
    expect(r.metrics.subjectH).toBeLessThan(SUBJECT_H);
  });

  it("quarantines a subject on a coloured ground (1167)", async () => {
    const r = await normalizeImage(await packShot(800, 1000, 400, 600, INK, { r: 200, g: 40, b: 40 }));
    expect(r.status).toBe("quarantine");
    if (r.status !== "quarantine") return;
    expect(r.reasons.some((x) => x.startsWith("coloured border"))).toBe(true);
  });

  it("quarantines a full-bleed frame with nothing to trim (63015)", async () => {
    const r = await normalizeImage(await packShot(800, 900, 800, 900, INK));
    expect(r.status).toBe("quarantine");
    if (r.status !== "quarantine") return;
    expect(r.reasons.some((x) => x.startsWith("full-bleed frame"))).toBe(true);
    expect(r.metrics.bboxArea).toBeGreaterThan(0.94);
  });

  it("quarantines a source whose aspect is out of range", async () => {
    const r = await normalizeImage(await packShot(400, 1200, 200, 400));
    expect(r.status).toBe("quarantine");
    if (r.status !== "quarantine") return;
    expect(r.reasons).toContain("aspect 0.33");
  });

  it("quarantines a blank image", async () => {
    const blank = await sharp({ create: { width: 800, height: 1000, channels: 3, background: WHITE } })
      .png()
      .toBuffer();
    const r = await normalizeImage(blank);
    expect(r.status).toBe("quarantine");
    if (r.status !== "quarantine") return;
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("normalizes an alpha cut-out onto the white ground", async () => {
    const subject = await sharp({ create: { width: 300, height: 600, channels: 3, background: INK } })
      .png()
      .toBuffer();
    const cutout = await sharp({
      create: { width: 800, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: subject, left: 250, top: 200 }])
      .png()
      .toBuffer();
    const r = await normalizeImage(cutout);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect((await sharp(r.master).metadata()).hasAlpha).toBe(false);
    expect(await pixel(r.master, 20, 20)).toEqual([255, 255, 255]);
  });
});

describe("normalizeJson", () => {
  it("maps metrics to the media.normalize_json shape", async () => {
    const r = await normalizeImage(await packShot(800, 1000, 300, 600));
    if (r.status !== "ok") throw new Error("expected ok");
    const json = normalizeJson(r.metrics, false, []);
    expect(json).toEqual({
      subjectH: r.metrics.subjectH,
      subjectW: r.metrics.subjectW,
      widthBound: false,
      quarantined: false,
      reason: null,
      bbox: r.metrics.bboxArea,
      edgeSat: r.metrics.edgeSat,
      scale: r.metrics.scale,
    });
  });

  it("joins every reason that fired", async () => {
    const r = await normalizeImage(await packShot(800, 900, 800, 900, { r: 200, g: 40, b: 40 }));
    if (r.status !== "quarantine") throw new Error("expected quarantine");
    const json = normalizeJson(r.metrics, true, r.reasons);
    expect(json.quarantined).toBe(true);
    expect(json.reason).toBe(r.reasons.join("; "));
    expect(json.reason).toContain("full-bleed frame");
    expect(json.reason).toContain("coloured border");
  });
});

/**
 * The M0 acceptance statistic (v2 §5.1: 269 normalized / 26 quarantined out of 295 products with a
 * primary image). Guarded because it reads data/extract (absent in CI) and takes minutes.
 */
const CORPUS = path.resolve(__dirname, "../../../../../data/extract/04_catalog/products");
describe.runIf(process.env.SEED_MEDIA_CORPUS === "1" && existsSync(CORPUS))("real corpus", () => {
  it("normalizes 269 ± 5 primaries and quarantines 26 ± 5", { timeout: 30 * 60_000 }, async () => {
    let normalized = 0;
    let quarantined = 0;
    let widthBound = 0;
    let atTarget = 0;
    let failed = 0;
    for (const id of readdirSync(CORPUS)) {
      const dir = path.join(CORPUS, id, "images");
      if (!existsSync(dir)) continue;
      const first = readdirSync(dir).sort()[0];
      if (first === undefined) continue;
      try {
        const r = await normalizeImage(await readFile(path.join(dir, first)));
        if (r.status === "ok") {
          normalized++;
          if (r.metrics.widthBound) widthBound++;
          else if (Math.abs(r.metrics.subjectH - SUBJECT_H) < AT_TARGET_TOLERANCE) atTarget++;
        } else {
          quarantined++;
        }
      } catch {
        failed++;
      }
    }
    console.log({ normalized, widthBound, atTarget, quarantined, failed });
    expect(failed).toBe(0);
    expect(Math.abs(normalized - 269)).toBeLessThanOrEqual(5);
    expect(Math.abs(quarantined - 26)).toBeLessThanOrEqual(5);
  });
});
