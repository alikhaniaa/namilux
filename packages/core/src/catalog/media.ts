// DECISION (M0 step 3): Renditions / ImageRef are declared once in ../types, and `mediaUrl` is owned by
// ../url/routes.ts (the spec: "never emit a URL that does not go through packages/core/src/url/*").
// This module re-exports the canonical declarations so ./cards, ./nav, ../content/* keep importing
// ImageRef from here.
import type { ImageRef, Renditions } from "../types";
import { mediaUrl } from "../url/routes";

export type { ImageRef, Renditions };
export { mediaUrl };

export const MEDIA_PUBLIC_PREFIX = "/media/";

/** A reviewed manufacturer set replaces legacy gallery thumbnails on the public PDP.
 * Old associations/files remain in the admin and backups; no catalog media is deleted.
 */
export function preferOfficialImages(images: ImageRef[]): ImageRef[] {
  const reviewed = images.filter((image) => /(?:^|\/)official\//.test(image.renditions?.master ?? image.key));
  return reviewed.length > 0 ? reviewed : images;
}

export type RenditionFormat = "avif" | "webp";

export type NormalizeInfo = {
  subjectH?: number;
  widthBound?: boolean;
  quarantined?: boolean;
  reason?: string;
};

export type MediaRowLike = {
  id: string;
  kind: "image" | "video" | "file";
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string;
  lqip: string | null;
  renditionsJson: Renditions | null;
  normalizeJson: NormalizeInfo | null;
};

export type VideoRef = {
  id: string;
  src: string;
  mime: string;
  durationMs: number | null;
  poster: ImageRef | null;
};

/** The format `imgSrc` tries when the requested one has no renditions (rules: avif↔webp, then master). */
const OTHER_FORMAT: Readonly<Record<RenditionFormat, RenditionFormat>> = { avif: "webp", webp: "avif" };

type RenditionEntry = { width: number; key: string };

/**
 * One rendition map (`renditions_json.avif` / `.webp`) as ascending {width, key} pairs.
 * `renditions_json` is jsonb, so every value is re-checked at runtime: non-numeric, zero, negative
 * and non-finite width keys are ignored, and a non-string / empty storage key is dropped - no throw.
 */
function entriesFor(ref: ImageRef, format: RenditionFormat): RenditionEntry[] {
  const map: unknown = ref.renditions?.[format];
  if (typeof map !== "object" || map === null) return [];
  const entries: RenditionEntry[] = [];
  for (const [rawWidth, rawKey] of Object.entries(map as Record<string, unknown>)) {
    const width = Number(rawWidth);
    if (!Number.isFinite(width) || width <= 0) continue;
    if (typeof rawKey !== "string" || rawKey.trim() === "") continue;
    entries.push({ width, key: rawKey });
  }
  entries.sort((a, b) => a.width - b.width);
  return entries;
}

/**
 * The full-size source key: `renditions.master` when the pipeline wrote one, else the media row's
 * own storage key (`ImageRef.key`), which is the original object and is always first-party.
 */
function masterKeyOf(ref: ImageRef): string {
  const master: unknown = ref.renditions?.master;
  if (typeof master === "string" && master.trim() !== "") return master;
  return ref.key;
}

/** Smallest entry whose width ≥ target; when none is large enough, the largest (never upsample). */
function pickEntry(entries: readonly RenditionEntry[], target: number): RenditionEntry | undefined {
  // DECISION: a NaN request degrades to the smallest rendition (cheapest byte cost) rather than
  // throwing; ±Infinity keeps its meaning (Infinity → nothing is large enough → the largest).
  const want = Number.isNaN(target) ? 0 : target;
  return entries.find((e) => e.width >= want) ?? entries[entries.length - 1];
}

/** null / NaN / negative dimensions become 0 - the storefront reserves space, it never gets NaN. */
function dimension(value: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

export function toImageRef(
  row: MediaRowLike,
  opts?: { altFallback?: string; allowQuarantined?: boolean },
): ImageRef | null {
  if (row.kind !== "image") return null;
  const renditions = row.renditionsJson;
  if (renditions === null || typeof renditions !== "object") return null;
  if (row.normalizeJson?.quarantined === true && opts?.allowQuarantined !== true) return null;

  const rowAlt = row.alt.trim();
  const alt = rowAlt === "" ? (opts?.altFallback ?? "").trim() : rowAlt;

  // DECISION: the canonical ImageRef (../types, the spec) carries `key` (the media row's unique
  // storage_key) instead of the header's `id`, and it has no `subjectH` slot - normalize_json.subjectH
  // stays a pipeline/QA fact (v2 §5.1) and is not needed to render a card. The canonical type wins,
  // exactly as the M0 step-3 de-duplication decided; recorded in the spec.
  const ref: ImageRef = {
    key: row.storageKey,
    alt,
    width: dimension(row.width),
    height: dimension(row.height),
    renditions,
  };

  // DECISION: lqip is passed through verbatim, but only when it really is an inline image data URI.
  // It is the single `data:` value a card emits (rules), so a drifted or hostile row value can never
  // become a `javascript:` / `data:text/html` sink; a missing placeholder is only a cosmetic loss.
  const lqip = row.lqip?.trim();
  if (lqip !== undefined && lqip.startsWith("data:image/")) ref.lqip = lqip;

  return ref;
}

export function toVideoRef(row: MediaRowLike, poster?: ImageRef | null): VideoRef | null {
  if (row.kind !== "video") return null;
  return {
    id: row.id,
    src: mediaUrl(row.storageKey),
    mime: row.mime,
    durationMs: row.durationMs,
    poster: poster ?? null,
  };
}

export function imgSrc(ref: ImageRef, width: number, format: RenditionFormat = "webp"): string {
  const entries = entriesFor(ref, format);
  const pool = entries.length > 0 ? entries : entriesFor(ref, OTHER_FORMAT[format]);
  const picked = pickEntry(pool, width);
  return mediaUrl(picked?.key ?? masterKeyOf(ref));
}

export function imgSrcSet(ref: ImageRef, format: RenditionFormat): string {
  // DECISION: no cross-format fallback here (unlike imgSrc, whose rules ask for one). A srcset is
  // consumed by `<source type="image/avif">`, so serving webp bytes under the avif type would be a
  // lie the browser cannot recover from; an empty srcset makes it fall through to the next
  // <source> / <img src>. `largestRendition` returning null in the same case confirms the reading.
  return entriesFor(ref, format)
    .map((e) => `${mediaUrl(e.key)} ${e.width}w`)
    .join(", ");
}

export function largestRendition(
  ref: ImageRef,
  format: RenditionFormat,
): { width: number; url: string } | null {
  const entries = entriesFor(ref, format);
  const largest = entries[entries.length - 1];
  if (largest === undefined) return null;
  return { width: largest.width, url: mediaUrl(largest.key) };
}

export function ogSourceKey(ref: ImageRef): string {
  return masterKeyOf(ref);
}
