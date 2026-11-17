import { UPLOAD_MAX_BYTES } from "@namilux/core";
import type { UploadMimeType } from "@namilux/core/constants";

export { UPLOAD_MAX_BYTES };

/**
 * Container signatures. jpeg/png are self-contained; webp (RIFF….WEBP), avif (ftypavif @4) and mp4
 * (ftyp @4 + a video brand) need the extra container check applied in `detect` below.
 */
export const MAGIC: { mime: UploadMimeType; sig: number[]; offset?: number }[] = [
  { mime: "image/jpeg", sig: [0xff, 0xd8, 0xff] },
  { mime: "image/png", sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/webp", sig: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"; "WEBP" verified at offset 8
  { mime: "image/avif", sig: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], offset: 4 }, // "ftypavif"
  { mime: "video/mp4", sig: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp"; brand verified at 8
];

const EXT: Record<UploadMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
};

const MP4_BRANDS = ["isom", "mp41", "mp42", "avc1", "iso2", "iso5", "dash", "mmp4"];
const POLYGLOT_MARKERS = ["<?php", "<script", "<svg", "%pdf", "<!doctype html", "<html"];
const SCAN_HEAD = 4096;

function matchAt(bytes: Uint8Array, sig: number[], offset: number): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len && i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

/** The detected canonical mime, or null when no signature matches. */
function detect(bytes: Uint8Array): UploadMimeType | null {
  for (const { mime, sig, offset = 0 } of MAGIC) {
    if (!matchAt(bytes, sig, offset)) continue;
    if (mime === "image/webp" && ascii(bytes, 8, 4) !== "WEBP") continue;
    if (mime === "video/mp4" && !MP4_BRANDS.includes(ascii(bytes, 8, 4).toLowerCase())) continue;
    return mime;
  }
  return null;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  // Skip a UTF-8 BOM and leading whitespace, then look for an XML/SVG opener.
  const head = ascii(bytes, 0, 512).replace(/^ï»¿/, "").trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg") || head.includes("<svg");
}

/** Byte offset just past the image's real end (JPEG EOI / PNG IEND), or -1 when not applicable. */
function trailerEnd(bytes: Uint8Array, mime: UploadMimeType): number {
  if (mime === "image/jpeg") {
    for (let i = bytes.length - 2; i >= 2; i -= 1) if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2;
  }
  if (mime === "image/png") {
    const marker = [0x49, 0x45, 0x4e, 0x44]; // "IEND"
    for (let i = bytes.length - 8; i >= 8; i -= 1) if (matchAt(bytes, marker, i)) return i + 8; // IEND + 4-byte CRC
  }
  return -1;
}

function hasMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return POLYGLOT_MARKERS.some((m) => lower.includes(m));
}

/** Script/markup smuggled in the header region or appended after the real image end → reject. */
function isPolyglot(bytes: Uint8Array, mime: UploadMimeType): boolean {
  if (hasMarker(ascii(bytes, 0, SCAN_HEAD))) return true;
  const end = trailerEnd(bytes, mime);
  if (end >= 0 && end < bytes.length) {
    const tail = ascii(bytes, end, bytes.length - end);
    if (tail.trim() !== "" && (hasMarker(tail) || /[<%]/.test(tail))) return true;
  }
  return false;
}

function normalizeDeclared(mime: string): UploadMimeType | null {
  const m = mime.trim().toLowerCase();
  if (m === "image/jpg") return "image/jpeg";
  return (Object.keys(EXT) as UploadMimeType[]).includes(m as UploadMimeType) ? (m as UploadMimeType) : null;
}

export function validateUpload(
  bytes: Uint8Array,
  declaredMime: string,
  declaredName: string,
):
  | { ok: true; mime: UploadMimeType; ext: string }
  | { ok: false; reason: "too_large" | "unknown_type" | "mismatch" | "svg_forbidden" | "polyglot" } {
  if (bytes.length > UPLOAD_MAX_BYTES) return { ok: false, reason: "too_large" };

  // SVG is forbidden outright (active content), regardless of how it is declared or named.
  if (declaredMime.trim().toLowerCase() === "image/svg+xml" || declaredName.toLowerCase().endsWith(".svg") || looksLikeSvg(bytes)) {
    return { ok: false, reason: "svg_forbidden" };
  }

  const detected = detect(bytes);
  if (detected === null) return { ok: false, reason: "unknown_type" };

  if (isPolyglot(bytes, detected)) return { ok: false, reason: "polyglot" };

  // The declared type is never trusted, but when it makes a concrete (recognised) claim that
  // disagrees with the bytes, that is a red flag, not something to silently "fix".
  const declared = normalizeDeclared(declaredMime);
  if (declared !== null && declared !== detected) return { ok: false, reason: "mismatch" };

  return { ok: true, mime: detected, ext: EXT[detected] };
}
