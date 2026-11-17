import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { EXTRACT_META, extractPath } from "./paths.js";

export type MediaIndexItem = {
  id: number;
  sourceUrl: string;
  alt: string;
  mime: string;
  width: number | null;
  height: number | null;
  localFile: string | null;
  allowed: boolean;
};

export const ALLOWED_MIME: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export const REJECTED_MIME_NOTE: Record<string, string> = {
  "image/svg+xml": "script vector — rejected by the spec",
  "audio/wav": "66 stray uploads, 4.64 GB — excluded (data-quality.md)",
  "audio/mpeg": "stray upload — excluded",
  "application/x-font-woff2": "fonts uploaded to the media library — excluded",
  "text/html": "html upload — excluded",
  "video/mp4": "video re-mux is P2 — excluded at seed",
  "image/gif": "not in the spec allow-list — excluded",
};

const UPLOADS_MARKER = "/wp-content/uploads/";
/** WordPress appends "-<w>x<h>" right before the extension for every generated rendition. */
const SIZE_SUFFIX_RE = /-\d{1,5}x\d{1,5}(?=\.[a-z0-9]{2,5}$)/i;
/** The downloader replaced these with "_" so the tree works on Windows. */
const WINDOWS_UNSAFE_RE = /[<>:"|?*]/g;

export function normalizeUploadUrl(u: string): string {
  let s = (u ?? "").trim();
  if (!s) return "";
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(0, hash);
  const query = s.indexOf("?");
  if (query >= 0) s = s.slice(0, query);
  if (s.startsWith("//")) s = `https:${s}`;
  else if (s.startsWith("/")) s = `${EXTRACT_META.origin}${s}`;
  return s.replace(SIZE_SUFFIX_RE, "");
}

function decodeTolerant(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function localFileForUrl(dir: string, url: string): string | null {
  const root = extractPath(dir, "mediaFilesDir");
  // A single existence check for the whole tree: an absent (gitignored) files/ dir must not cost
  // one warning per image - the caller sees stats.localPresent === 0 instead.
  if (!existsSync(root)) return null;
  const normalized = normalizeUploadUrl(url);
  if (!normalized) return null;
  let pathname: string;
  try {
    pathname = new URL(normalized).pathname;
  } catch {
    pathname = normalized;
  }
  const idx = pathname.indexOf(UPLOADS_MARKER);
  const rel = idx >= 0 ? pathname.slice(idx + UPLOADS_MARKER.length) : pathname.replace(/^\/+/, "");
  const segments = decodeTolerant(rel)
    .split("/")
    // DECISION: "." / ".." segments are dropped rather than resolved - a crafted legacy URL must
    // never escape 05_media/files/ (the spec path-traversal rule).
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(WINDOWS_UNSAFE_RE, "_"));
  if (!segments.length) return null;
  const file = path.join(root, ...segments);
  return existsSync(file) ? file : null;
}

export function altFor(item: MediaIndexItem | undefined, fallback: string): string {
  const alt = (item?.alt ?? "").trim();
  return alt || fallback;
}

export async function readMediaIndex(dir: string): Promise<{
  byId: Map<number, MediaIndexItem>;
  byUrl: Map<string, MediaIndexItem>;
  stats: { rows: number; withAlt: number; allowed: number; localPresent: number };
}> {
  const buf = readFileSync(extractPath(dir, "mediaCsv"));
  const rows: Record<string, string | undefined>[] = parse(buf, { columns: true, bom: true, relax_column_count: true });
  const byId = new Map<number, MediaIndexItem>();
  const byUrl = new Map<string, MediaIndexItem>();
  let withAlt = 0;
  let allowedCount = 0;
  let localPresent = 0;

  for (const r of rows) {
    const id = Number(r["id"]);
    const sourceUrl = (r["source_url"] ?? "").trim();
    if (!Number.isFinite(id) || !sourceUrl) continue;
    const mime = (r["mime_type"] ?? "").trim();
    const alt = (r["alt_text"] ?? "").trim();
    const allowed = ALLOWED_MIME.includes(mime);
    const width = Number(r["width"]);
    const height = Number(r["height"]);
    const localFile = allowed ? localFileForUrl(dir, sourceUrl) : null;
    const item: MediaIndexItem = {
      id,
      sourceUrl,
      alt,
      mime,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      localFile,
      allowed,
    };
    if (alt) withAlt += 1;
    if (allowed) allowedCount += 1;
    if (localFile) localPresent += 1;
    byId.set(id, item);
    // Keyed on the normalised original so a "-800x800" reference in legacy HTML resolves here.
    byUrl.set(normalizeUploadUrl(sourceUrl), item);
  }

  return { byId, byUrl, stats: { rows: rows.length, withAlt, allowed: allowedCount, localPresent } };
}
