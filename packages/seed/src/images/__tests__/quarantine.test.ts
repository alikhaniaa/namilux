import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { QUARANTINE, chooseRoles, edgeSaturation, isPrimaryEligible, quarantineReasons } from "../quarantine.js";

const solid = (w: number, h: number, background: { r: number; g: number; b: number }): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background } })
    .png()
    .toBuffer();

/** White frame with a dark subject in the middle: the healthy pack-shot case. */
async function packShot(): Promise<Buffer> {
  const subject = await solid(120, 160, { r: 30, g: 30, b: 30 });
  return sharp({ create: { width: 400, height: 500, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: subject, left: 140, top: 170 }])
    .png()
    .toBuffer();
}

describe("edgeSaturation", () => {
  it("is 0 on a pure white image and ≈ 1 on a saturated red frame", async () => {
    expect(await edgeSaturation(await solid(200, 250, { r: 255, g: 255, b: 255 }))).toBe(0);
    expect(await edgeSaturation(await solid(200, 250, { r: 255, g: 0, b: 0 }))).toBeCloseTo(1, 2);
  });

  it("stays well under the threshold for a clean pack shot", async () => {
    const sat = await edgeSaturation(await packShot());
    expect(sat).toBeLessThan(QUARANTINE.EDGE_SATURATION);
  });

  it("flattens alpha on white instead of reading undefined colour under transparency", async () => {
    const cutout = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    expect(await edgeSaturation(cutout)).toBe(0);
  });

  it("samples only the outer border", async () => {
    const middle = await solid(60, 60, { r: 255, g: 0, b: 0 });
    const framed = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: middle, left: 70, top: 70 }])
      .png()
      .toBuffer();
    expect(await edgeSaturation(framed)).toBe(0);
  });
});

describe("quarantineReasons", () => {
  const clean = { srcAspect: 1, bboxArea: 0.5, edgeSat: 0.001 };

  it("passes a clean pack shot", () => {
    expect(quarantineReasons(clean)).toEqual([]);
  });

  it("treats bbox 0.94 as acceptable and 0.9401 as full-bleed (strict >)", () => {
    expect(quarantineReasons({ ...clean, bboxArea: QUARANTINE.MAX_BBOX_AREA })).toEqual([]);
    expect(quarantineReasons({ ...clean, bboxArea: 0.9401 })).toEqual(["full-bleed frame (bbox 94%)"]);
  });

  it("holds the aspect boundaries", () => {
    expect(quarantineReasons({ ...clean, srcAspect: QUARANTINE.MIN_AR })).toEqual([]);
    expect(quarantineReasons({ ...clean, srcAspect: QUARANTINE.MAX_AR })).toEqual([]);
    expect(quarantineReasons({ ...clean, srcAspect: 0.4 })).toEqual(["aspect 0.40"]);
    expect(quarantineReasons({ ...clean, srcAspect: 2.01 })).toEqual(["aspect 2.01"]);
  });

  it("holds the edge-saturation boundary", () => {
    expect(quarantineReasons({ ...clean, edgeSat: QUARANTINE.EDGE_SATURATION })).toEqual([]);
    expect(quarantineReasons({ ...clean, edgeSat: 0.204 })).toEqual(["coloured border (sat 0.204)"]);
  });

  it("gives both reasons for the screenshot-like hero (63015: bbox 100 %, sat 0.104)", () => {
    expect(quarantineReasons({ srcAspect: 1, bboxArea: 1, edgeSat: 0.104 })).toEqual([
      "full-bleed frame (bbox 100%)",
      "coloured border (sat 0.104)",
    ]);
  });

  it("reports an empty trim", () => {
    expect(quarantineReasons({ ...clean, bboxW: 1, bboxH: 1 })).toContain("empty after trim");
  });
});

describe("chooseRoles", () => {
  const img = (n: number, over: Partial<{ exists: boolean; quarantined: boolean; failed: boolean }> = {}) => ({
    n,
    exists: true,
    quarantined: false,
    failed: false,
    ...over,
  });

  it("makes the first clean image primary and the rest gallery in n order", () => {
    expect(chooseRoles([img(2), img(1), img(3)])).toEqual([
      { n: 1, role: "primary", sort: 0 },
      { n: 2, role: "gallery", sort: 1 },
      { n: 3, role: "gallery", sort: 2 },
    ]);
  });

  it("falls through to the second image when the first is quarantined, keeping the first as gallery", () => {
    expect(chooseRoles([img(1, { quarantined: true }), img(2)])).toEqual([
      { n: 2, role: "primary", sort: 0 },
      { n: 1, role: "gallery", sort: 1 },
    ]);
  });

  it("gives no primary when every image is quarantined", () => {
    const roles = chooseRoles([img(1, { quarantined: true }), img(2, { quarantined: true })]);
    expect(roles.every((r) => r.role === "gallery")).toBe(true);
    expect(roles.map((r) => r.sort)).toEqual([1, 2]);
  });

  it("excludes missing and failed images", () => {
    expect(chooseRoles([img(1, { exists: false }), img(2, { failed: true }), img(3)])).toEqual([
      { n: 3, role: "primary", sort: 0 },
    ]);
  });

  it("returns [] when the product has no images at all (41546)", () => {
    expect(chooseRoles([])).toEqual([]);
    expect(chooseRoles([img(1, { exists: false })])).toEqual([]);
  });
});

describe("isPrimaryEligible", () => {
  it("requires an existing, non-failed, non-quarantined image", () => {
    expect(isPrimaryEligible({ exists: true, failed: false, quarantined: false })).toBe(true);
    expect(isPrimaryEligible({ exists: false, failed: false, quarantined: false })).toBe(false);
    expect(isPrimaryEligible({ exists: true, failed: true, quarantined: false })).toBe(false);
    expect(isPrimaryEligible({ exists: true, failed: false, quarantined: true })).toBe(false);
  });
});
