import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fsStore, type ObjectStore } from "../manifest.js";
import { BUDGET_BYTES, emitRenditions, masterKeyFor, pickWidths, renditionKey } from "../renditions.js";

const tmp = (): Promise<string> => mkdtemp(path.join(tmpdir(), "nl-rend-"));

const flat = (w: number, h: number, background = { r: 40, g: 60, b: 90 }): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background } })
    .png()
    .toBuffer();

/** Deterministic LCG noise: incompressible, so it breaches the tile budget. */
function noise(w: number, h: number, seed = 7): Promise<Buffer> {
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

/** Wraps a store so a test can count real writes. */
function counting(store: ObjectStore): ObjectStore & { writes: number } {
  const wrapped = {
    root: store.root,
    dry: store.dry,
    writes: 0,
    has: (k: string) => store.has(k),
    stat: (k: string) => store.stat(k),
    async put(k: string, b: Buffer, m: string) {
      const r = await store.put(k, b, m);
      if (!r.skipped) wrapped.writes++;
      return r;
    },
  };
  return wrapped;
}

describe("pickWidths", () => {
  it("emits every slot width when the master is large enough", () => {
    expect(pickWidths("product", 1600)).toEqual([320, 480, 640, 960, 1280]);
  });

  it("skips widths above the master and adds the master width as the top rendition", () => {
    expect(pickWidths("journal_inline", 800)).toEqual([640, 800]);
    expect(pickWidths("product", 500)).toEqual([320, 480, 500]);
  });

  it("returns the master width alone when it is below every listed width", () => {
    expect(pickWidths("product", 200)).toEqual([200]);
  });

  it("returns nothing for the og slot", () => {
    expect(pickWidths("og", 1200)).toEqual([]);
  });
});

describe("keys", () => {
  it("names renditions and the master", () => {
    expect(renditionKey("p/1044/1/a8f3c0d1e2f30456", 480, "avif")).toBe("p/1044/1/a8f3c0d1e2f30456-480.avif");
    expect(renditionKey("p/1044/1/a8f3c0d1e2f30456", 480, "webp")).toBe("p/1044/1/a8f3c0d1e2f30456-480.webp");
    expect(masterKeyFor("p/1044/1/a8f3c0d1e2f30456")).toBe("p/1044/1/a8f3c0d1e2f30456.jpg");
  });
});

describe("emitRenditions", () => {
  it("emits 11 objects for a product master and reports its dimensions", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const r = await emitRenditions(await flat(1600, 2000), "product", "p/1044/1/aaaaaaaaaaaaaaaa", store);

    expect(Object.keys(r.bytes)).toHaveLength(11);
    expect(Object.keys(r.renditions.avif)).toEqual(["320", "480", "640", "960", "1280"]);
    expect(Object.keys(r.renditions.webp)).toEqual(["320", "480", "640", "960", "1280"]);
    expect(r.renditions.master).toBe("p/1044/1/aaaaaaaaaaaaaaaa.jpg");
    expect([r.width, r.height]).toEqual([1600, 2000]);
    for (const key of Object.keys(r.bytes)) expect(await store.has(key)).toBe(true);
    expect(r.overBudget).toEqual([]);

    const tile = await sharp(await readFile(path.join(dir, r.renditions.avif["480"] ?? ""))).metadata();
    // sharp reports the container ("heif") and the codec separately for AVIF
    expect(tile.format).toBe("heif");
    expect(tile.compression).toBe("av1");
    expect([tile.width, tile.height]).toEqual([480, 600]);
  });

  it("skips widths above the master and still emits the top rendition", async () => {
    const store = fsStore(await tmp(), { dry: false });
    const r = await emitRenditions(await flat(800, 533), "journal_inline", "c/bbbbbbbbbbbbbbbb", store);
    expect(Object.keys(r.renditions.avif)).toEqual(["640", "800"]);
    expect(r.width).toBe(800);
  });

  it("centre-crops a 4:3 source to 16:9 at every width", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const r = await emitRenditions(await flat(1200, 900), "journal_cover", "c/cccccccccccccccc", store);
    expect(r.width).toBe(1200);
    expect(r.height).toBe(Math.round((1200 * 9) / 16));
    for (const [w, key] of Object.entries(r.renditions.webp)) {
      const meta = await sharp(await readFile(path.join(dir, key))).metadata();
      expect([meta.width, meta.height]).toEqual([Number(w), Math.round((Number(w) * 9) / 16)]);
    }
  });

  it("flags a 480 tile over the 35 KB budget without failing", async () => {
    const store = fsStore(await tmp(), { dry: false });
    const r = await emitRenditions(await noise(640, 800), "product", "p/9/1/dddddddddddddddd", store);
    const tile = r.renditions.avif["480"] ?? "";
    expect(r.bytes[tile]).toBeGreaterThan(BUDGET_BYTES.tileAvif480);
    expect(r.overBudget).toEqual([tile]);
    // High-entropy AVIF encoding is deliberately expensive; this checks the byte-budget result,
    // not an encoding-speed SLA. Keep a bounded allowance for slower Windows/CI machines.
  }, 120_000);

  it("re-uses a pre-populated store without encoding anything", async () => {
    const dir = await tmp();
    const master = await flat(640, 800);
    const first = counting(fsStore(dir, { dry: false }));
    const a = await emitRenditions(master, "product", "p/7/1/eeeeeeeeeeeeeeee", first);
    expect(first.writes).toBe(Object.keys(a.bytes).length);

    const second = counting(fsStore(dir, { dry: false }));
    const b = await emitRenditions(master, "product", "p/7/1/eeeeeeeeeeeeeeee", second);
    expect(second.writes).toBe(0);
    expect(b.renditions).toEqual(a.renditions);
    expect(b.bytes).toEqual(a.bytes);
    expect([b.width, b.height]).toEqual([a.width, a.height]);
  });

  it("writes nothing through a dry store", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: true });
    const r = await emitRenditions(await flat(640, 800), "product", "p/8/1/ffffffffffffffff", store);
    expect(Object.keys(r.bytes).length).toBeGreaterThan(0);
    for (const key of Object.keys(r.bytes)) expect(await store.has(key)).toBe(false);
  });

  it("flattens a master that still carries alpha", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const subject = await sharp({ create: { width: 200, height: 250, channels: 3, background: { r: 20, g: 20, b: 20 } } })
      .png()
      .toBuffer();
    const withAlpha = await sharp({
      create: { width: 640, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: subject, left: 220, top: 275 }])
      .png()
      .toBuffer();
    const r = await emitRenditions(withAlpha, "product", "p/6/1/1111111111111111", store);
    for (const key of [...Object.values(r.renditions.webp), r.renditions.master]) {
      const meta = await sharp(await readFile(path.join(dir, key))).metadata();
      expect(meta.hasAlpha).toBe(false);
    }
  });
});
