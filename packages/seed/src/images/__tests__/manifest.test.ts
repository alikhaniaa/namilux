import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MANIFEST_DIR,
  MANIFEST_FILE,
  QUARANTINE_FILE,
  contentHash,
  contentKeyBase,
  fsStore,
  manifestStats,
  mediaRow,
  ogKeyFor,
  productKeyBase,
  writeManifest,
  type ImageManifest,
  type ImageManifestEntry,
} from "../manifest.js";
import type { NormalizeMetrics } from "../normalize.js";

const tmp = (): Promise<string> => mkdtemp(path.join(tmpdir(), "nl-media-"));

const metrics = (over: Partial<NormalizeMetrics> = {}): NormalizeMetrics => ({
  srcW: 800,
  srcH: 1000,
  srcAspect: 0.8,
  bboxW: 400,
  bboxH: 600,
  bboxArea: 0.3,
  edgeSat: 0.001,
  scale: 2.2,
  subjectH: 0.66,
  subjectW: 0.44,
  widthBound: false,
  ...over,
});

const entry = (over: Partial<ImageManifestEntry> = {}): ImageManifestEntry => ({
  productId: 1044,
  n: 1,
  sourceFile: "images/01.jpg",
  status: "ok",
  metrics: metrics(),
  ...over,
});

describe("fsStore", () => {
  it("writes atomically, then has()/stat() see the key", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const key = "p/1044/1/a8f3c0d1e2f30456.jpg";

    expect(await store.has(key)).toBe(false);
    expect(await store.stat(key)).toBeNull();

    const put = await store.put(key, Buffer.from("hello"), "image/jpeg");
    expect(put).toEqual({ bytes: 5, skipped: false });
    expect(await store.has(key)).toBe(true);
    expect(await store.stat(key)).toEqual({ bytes: 5 });
    expect(await readFile(path.join(dir, key), "utf8")).toBe("hello");
    // no temp file left behind
    expect((await readdir(path.join(dir, "p/1044/1"))).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("skips an existing key and reports the existing size", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const key = "c/0123456789abcdef.webp";
    await store.put(key, Buffer.from("original"), "image/webp");

    const again = await store.put(key, Buffer.from("x"), "image/webp");
    expect(again).toEqual({ bytes: 8, skipped: true });
    expect(await readFile(path.join(dir, key), "utf8")).toBe("original");
  });

  it("rejects traversal, absolute keys, uppercase and Persian characters", async () => {
    const store = fsStore(await tmp(), { dry: false });
    for (const bad of ["p/../x.jpg", "../x.jpg", "/p/x.jpg", "p//x.jpg", "P/1044/1/a.jpg", "p/کالا.jpg", ""]) {
      await expect(store.put(bad, Buffer.from("x"), "image/jpeg")).rejects.toThrow("invalid storage key");
      await expect(store.has(bad)).rejects.toThrow("invalid storage key");
    }
  });

  it("writes nothing in dry mode but still reports existing keys as skipped", async () => {
    const dir = await tmp();
    const real = fsStore(dir, { dry: false });
    await real.put("p/1/1/aaaaaaaaaaaaaaaa.jpg", Buffer.from("abc"), "image/jpeg");

    const dry = fsStore(dir, { dry: true });
    expect(dry.dry).toBe(true);
    const fresh = await dry.put("p/2/1/bbbbbbbbbbbbbbbb.jpg", Buffer.from("12345"), "image/jpeg");
    expect(fresh).toEqual({ bytes: 5, skipped: false });
    expect(await dry.has("p/2/1/bbbbbbbbbbbbbbbb.jpg")).toBe(false);
    // has() reflects the real dir, so a dry run after a real run reports skips
    expect(await dry.put("p/1/1/aaaaaaaaaaaaaaaa.jpg", Buffer.from("abc"), "image/jpeg")).toEqual({
      bytes: 3,
      skipped: true,
    });
  });

  it("ignores a leftover .tmp-* file from a crashed run and overwrites it", async () => {
    const dir = await tmp();
    const store = fsStore(dir, { dry: false });
    const key = "p/9/1/cccccccccccccccc.jpg";
    await mkdir(path.join(dir, "p/9/1"), { recursive: true });
    await writeFile(path.join(dir, `${key}.tmp-${process.pid}`), "garbage");

    expect(await store.has(key)).toBe(false);
    const put = await store.put(key, Buffer.from("clean"), "image/jpeg");
    expect(put.skipped).toBe(false);
    expect(await readFile(path.join(dir, key), "utf8")).toBe("clean");
  });
});

describe("keys", () => {
  it("hashes content to 16 hex chars, stably", () => {
    const h = contentHash(Buffer.from("namilux"));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash(Buffer.from("namilux"))).toBe(h);
    expect(contentHash(Buffer.from("namilux!"))).not.toBe(h);
  });

  it("builds the documented key layout", () => {
    expect(productKeyBase(1044, 1, "a8f3c0d1e2f30456")).toBe("p/1044/1/a8f3c0d1e2f30456");
    expect(contentKeyBase("a8f3c0d1e2f30456")).toBe("c/a8f3c0d1e2f30456");
    expect(ogKeyFor("p", 1044)).toBe("og/p/1044.jpg");
    expect(ogKeyFor("b", "dyson")).toBe("og/b/dyson.jpg");
    expect(ogKeyFor("c", "gifts")).toBe("og/c/gifts.jpg");
    expect(ogKeyFor("site", "ignored")).toBe("og/site.jpg");
  });
});

describe("manifestStats", () => {
  it("counts zero entries without NaN", () => {
    expect(manifestStats([])).toEqual({
      normalized: 0,
      widthBound: 0,
      atTarget: 0,
      quarantined: 0,
      missing: 0,
      failed: 0,
      productsWithPrimary: 0,
      productsWithoutPrimary: 0,
    });
  });

  it("counts at-target only for ok, non-width-bound entries within the tolerance", () => {
    const stats = manifestStats([
      entry({ productId: 1, metrics: metrics({ subjectH: 0.66 }), role: "primary" }),
      entry({ productId: 2, metrics: metrics({ subjectH: 0.6559 }), role: "primary" }),
      entry({ productId: 3, metrics: metrics({ subjectH: 0.65 }), role: "primary" }),
      entry({ productId: 4, metrics: metrics({ subjectH: 0.66, widthBound: true }), role: "primary" }),
      entry({ productId: 5, status: "quarantine", reasons: ["aspect 0.40"], role: "gallery" }),
      entry({ productId: 6, status: "missing" }),
      entry({ productId: 7, status: "failed", error: "boom" }),
    ]);
    expect(stats.normalized).toBe(4);
    expect(stats.widthBound).toBe(1);
    expect(stats.atTarget).toBe(2);
    expect(stats.quarantined).toBe(1);
    expect(stats.missing).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.productsWithPrimary).toBe(4);
    expect(stats.productsWithoutPrimary).toBe(3);
  });

  it("honours a custom tolerance", () => {
    const entries = [entry({ metrics: metrics({ subjectH: 0.65 }) })];
    expect(manifestStats(entries).atTarget).toBe(0);
    expect(manifestStats(entries, 0.02).atTarget).toBe(1);
  });
});

describe("writeManifest", () => {
  const manifest = (entries: ImageManifestEntry[]): ImageManifest => ({
    generatedAt: "2026-08-25T00:00:00.000Z",
    canvas: { w: 1600, h: 2000 },
    targetSubjectH: 0.66,
    entries,
    stats: manifestStats(entries),
  });

  it("writes both files, even in dry mode, with only the quarantined entries in the second", async () => {
    const dir = await tmp();
    const entries = [entry({ productId: 1 }), entry({ productId: 2, status: "quarantine", reasons: ["aspect 0.40"] })];
    const { manifestPath, quarantinePath } = await writeManifest(dir, manifest(entries), { dry: true });

    expect(manifestPath).toBe(path.join(dir, MANIFEST_DIR, MANIFEST_FILE));
    expect(quarantinePath).toBe(path.join(dir, MANIFEST_DIR, QUARANTINE_FILE));

    const written = JSON.parse(await readFile(manifestPath, "utf8")) as ImageManifest;
    expect(written.entries).toHaveLength(2);
    expect(written.stats.quarantined).toBe(1);

    const quarantined = JSON.parse(await readFile(quarantinePath, "utf8")) as ImageManifestEntry[];
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.productId).toBe(2);
  });
});

describe("mediaRow", () => {
  it("maps to the media table shape", () => {
    const row = mediaRow({
      id: "01JABCDEFGHJKMNPQRSTVWXYZ0",
      masterKey: "p/1044/1/a8f3c0d1e2f30456.jpg",
      masterBytes: 123456,
      width: 1600,
      height: 2000,
      alt: "ایرپ دایسون",
      lqip: "data:image/webp;base64,AAAA",
      renditions: { avif: { "320": "p/1044/1/a8f3c0d1e2f30456-320.avif" }, webp: {}, master: "p/1044/1/a8f3c0d1e2f30456.jpg" },
      normalizeJson: { subjectH: 0.66 },
    });
    expect(row.kind).toBe("image");
    expect(row.mime).toBe("image/jpeg");
    expect(row.source).toBe("legacy");
    expect(row.storageKey).toBe("p/1044/1/a8f3c0d1e2f30456.jpg");
    expect(row.bytes).toBe(123456);
  });
});
