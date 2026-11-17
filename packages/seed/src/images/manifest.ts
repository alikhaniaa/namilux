import { createHash } from "node:crypto";
import { mkdir, rename, stat as fsStat, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUBJECT_H, type NormalizeMetrics } from "./normalize.js";
import type { RenditionsJson } from "./renditions.js";

export interface ObjectStore {
  readonly root: string;
  readonly dry: boolean;
  put(key: string, bytes: Buffer, mime: string): Promise<{ bytes: number; skipped: boolean }>;
  has(key: string): Promise<boolean>;
  stat(key: string): Promise<{ bytes: number } | null>;
}

export const STORAGE_KEY_RE = /^[a-z0-9/._-]+$/;
export const MANIFEST_DIR = "manifest";
export const MANIFEST_FILE = "seed-images.json";
export const QUARANTINE_FILE = "seed-quarantine.json";

export type ImageManifestEntry = {
  productId: number;
  n: number;
  sourceFile: string;
  status: "ok" | "quarantine" | "failed" | "missing";
  metrics?: NormalizeMetrics;
  reasons?: string[];
  error?: string;
  keyBase?: string;
  mediaId?: string;
  role?: "primary" | "gallery";
};

export type ManifestStats = {
  normalized: number;
  widthBound: number;
  atTarget: number;
  quarantined: number;
  missing: number;
  failed: number;
  productsWithPrimary: number;
  productsWithoutPrimary: number;
};

export type ImageManifest = {
  generatedAt: string;
  canvas: { w: number; h: number };
  targetSubjectH: number;
  entries: ImageManifestEntry[];
  stats: ManifestStats;
};

export type MediaRowSeed = {
  id: string;
  kind: "image";
  storageKey: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  alt: string;
  lqip: string | null;
  renditionsJson: RenditionsJson;
  normalizeJson: object | null;
  source: "legacy";
};

/** The store is served by Caddy as static files: every key is generated, never user input. */
function assertKey(key: string): void {
  if (key.length === 0 || !STORAGE_KEY_RE.test(key)) throw new Error("invalid storage key");
  const segments = key.split("/");
  // DECISION: reject "..", empty segments (leading/trailing/double slash) and "." as well - the
  // regex alone would let "p/../x.jpg" through, and traversal is the one failure mode that turns a
  // static directory into an arbitrary-write primitive.
  if (segments.some((s) => s === "" || s === "." || s === "..")) throw new Error("invalid storage key");
}

export function fsStore(mediaDir: string, opts: { dry: boolean }): ObjectStore {
  const root = path.resolve(mediaDir);

  const full = (key: string): string => {
    assertKey(key);
    const resolved = path.resolve(root, key);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("invalid storage key");
    return resolved;
  };

  const statKey = async (key: string): Promise<{ bytes: number } | null> => {
    const target = full(key);
    try {
      const s = await fsStat(target);
      return s.isFile() ? { bytes: s.size } : null;
    } catch {
      return null;
    }
  };

  return {
    root,
    dry: opts.dry,
    async has(key) {
      return (await statKey(key)) !== null;
    },
    stat: statKey,
    async put(key, bytes, mime) {
      // `mime` is part of the ObjectStore interface because the S3 driver (M4) needs it; the fs
      // layout carries the type in the extension and Caddy serves it from there.
      void mime;
      const target = full(key);
      const existing = await statKey(key);
      if (opts.dry) return { bytes: existing ? existing.bytes : bytes.length, skipped: existing !== null };
      // Content-hashed keys: an existing key already holds these exact bytes, so never rewrite it.
      if (existing) return { bytes: existing.bytes, skipped: true };
      await mkdir(path.dirname(target), { recursive: true });
      // Atomic: a crashed run leaves a *.tmp-<pid> file that has() ignores and the next put replaces.
      const tmp = `${target}.tmp-${process.pid}`;
      await writeFile(tmp, bytes);
      await rename(tmp, target);
      return { bytes: bytes.length, skipped: false };
    },
  };
}

export function contentHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export function productKeyBase(productId: number, n: number, hash: string): string {
  return `p/${productId}/${n}/${hash}`;
}

export function contentKeyBase(hash: string): string {
  return `c/${hash}`;
}

export function ogKeyFor(kind: "p" | "b" | "c" | "site", id: string | number): string {
  return kind === "site" ? "og/site.jpg" : `og/${kind}/${id}.jpg`;
}

export function manifestStats(entries: ImageManifestEntry[], tolerance: number = 0.005): ManifestStats {
  const stats: ManifestStats = {
    normalized: 0,
    widthBound: 0,
    atTarget: 0,
    quarantined: 0,
    missing: 0,
    failed: 0,
    productsWithPrimary: 0,
    productsWithoutPrimary: 0,
  };
  const products = new Set<number>();
  const withPrimary = new Set<number>();

  for (const e of entries) {
    products.add(e.productId);
    if (e.role === "primary") withPrimary.add(e.productId);
    switch (e.status) {
      case "ok": {
        stats.normalized++;
        if (e.metrics?.widthBound) {
          stats.widthBound++;
        } else if (e.metrics && Math.abs(e.metrics.subjectH - SUBJECT_H) < tolerance) {
          // The QA gate (v2 §5.1): every non-quarantined subject is either at 66 % or width-bound.
          stats.atTarget++;
        }
        break;
      }
      case "quarantine":
        stats.quarantined++;
        break;
      case "missing":
        stats.missing++;
        break;
      case "failed":
        stats.failed++;
        break;
    }
  }

  stats.productsWithPrimary = withPrimary.size;
  stats.productsWithoutPrimary = products.size - withPrimary.size;
  return stats;
}

export async function writeManifest(
  mediaDir: string,
  m: ImageManifest,
  opts: { dry: boolean },
): Promise<{ manifestPath: string; quarantinePath: string }> {
  const dir = path.join(path.resolve(mediaDir), MANIFEST_DIR);
  const manifestPath = path.join(dir, MANIFEST_FILE);
  const quarantinePath = path.join(dir, QUARANTINE_FILE);
  // v1: "manifests are written even on --dry so QA tooling can read them" - the only disk write a
  // dry run performs, so `opts.dry` is accepted but never used to skip.
  void opts;
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify(m, null, 2) + "\n", "utf8");
  const quarantined = m.entries.filter((e) => e.status === "quarantine");
  await writeFile(quarantinePath, JSON.stringify(quarantined, null, 2) + "\n", "utf8");
  return { manifestPath, quarantinePath };
}

export function mediaRow(i: {
  id: string;
  masterKey: string;
  masterBytes: number;
  width: number;
  height: number;
  alt: string;
  lqip: string | null;
  renditions: RenditionsJson;
  normalizeJson: object | null;
}): MediaRowSeed {
  return {
    id: i.id,
    kind: "image",
    storageKey: i.masterKey,
    mime: "image/jpeg",
    bytes: i.masterBytes,
    width: i.width,
    height: i.height,
    alt: i.alt,
    lqip: i.lqip,
    renditionsJson: i.renditions,
    normalizeJson: i.normalizeJson,
    source: "legacy",
  };
}
