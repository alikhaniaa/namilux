import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { LQIP, lqip, lqipBytes } from "../lqip.js";

/** Deterministic LCG noise - the same bytes on every host, so the size assertions are stable. */
function noise(w: number, h: number, seed = 1): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < px.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    px[i] = s >>> 24;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

async function plate(): Promise<Buffer> {
  const subject = await sharp({ create: { width: 600, height: 800, channels: 3, background: { r: 24, g: 26, b: 28 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 1600, height: 2000, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: subject, left: 500, top: 320 }])
    .png()
    .toBuffer();
}

const decode = (uri: string): Buffer => Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64");

describe("lqip", () => {
  it("returns a webp data URI under the cap for a normalized plate", async () => {
    const uri = await lqip(await plate());
    expect(uri.startsWith(`data:${LQIP.mime};base64,`)).toBe(true);
    expect(lqipBytes(uri)).toBeLessThanOrEqual(LQIP.maxBytes);
    const meta = await sharp(decode(uri)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(LQIP.width);
  });

  it("falls back to 16 px / q30 when the noisy first pass is over budget", async () => {
    const uri = await lqip(await noise(40, 180));
    expect(lqipBytes(uri)).toBeLessThanOrEqual(LQIP.maxBytes);
    const meta = await sharp(decode(uri)).metadata();
    expect(meta.width).toBe(LQIP.fallback.width);
  });

  it("throws when even the fallback cannot fit 400 bytes", async () => {
    await expect(lqip(await noise(20, 4000))).rejects.toThrow("lqip exceeds 400 B");
  });

  it("does not enlarge a master narrower than 20 px", async () => {
    const tiny = await sharp({ create: { width: 8, height: 10, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer();
    const meta = await sharp(decode(await lqip(tiny))).metadata();
    expect(meta.width).toBe(8);
  });

  it("flattens alpha instead of emitting a transparent placeholder", async () => {
    const cutout = await sharp({
      create: { width: 200, height: 250, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const meta = await sharp(decode(await lqip(cutout))).metadata();
    expect(meta.hasAlpha).toBe(false);
  });
});

describe("lqipBytes", () => {
  it("measures the whole data URI in bytes", () => {
    expect(lqipBytes("")).toBe(0);
    expect(lqipBytes("data:image/webp;base64,AAAA")).toBe(27);
  });
});
