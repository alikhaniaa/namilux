import { describe, expect, it } from "vitest";
import { UPLOAD_MAX_BYTES, validateUpload } from "../validate";

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const flat: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) flat.push(ch.charCodeAt(0));
    else flat.push(...p);
  }
  return new Uint8Array(flat);
};

const JPEG_SOI = [0xff, 0xd8, 0xff, 0xe0];
const JPEG_EOI = [0xff, 0xd9];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0];

describe("upload validation", () => {
  it("accepts a real JPEG by its magic bytes", () => {
    const r = validateUpload(bytes(JPEG_SOI, [0x00, 0x10], JPEG_EOI), "image/jpeg", "photo.jpg");
    expect(r).toEqual({ ok: true, mime: "image/jpeg", ext: "jpg" });
  });

  it("rejects SVG whatever the declaration says", () => {
    expect(validateUpload(bytes("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), "image/png", "x.png").ok).toBe(false);
    expect(validateUpload(bytes(JPEG_SOI, JPEG_EOI), "image/svg+xml", "x").ok).toBe(false);
    expect(validateUpload(bytes(JPEG_SOI, JPEG_EOI), "image/jpeg", "logo.svg").ok).toBe(false);
  });

  it("rejects a PHP polyglot appended after the JPEG EOI", () => {
    const r = validateUpload(bytes(JPEG_SOI, [0x11, 0x22], JPEG_EOI, "<?php system($_GET[0]); ?>"), "image/jpeg", "evil.jpg");
    expect(r).toEqual({ ok: false, reason: "polyglot" });
  });

  it("rejects a script tag inside the header region", () => {
    const r = validateUpload(bytes(JPEG_SOI, "<script>alert(1)</script>", JPEG_EOI), "image/jpeg", "x.jpg");
    expect(r).toEqual({ ok: false, reason: "polyglot" });
  });

  it("enforces the size cap", () => {
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    big.set(JPEG_SOI, 0);
    expect(validateUpload(big, "image/jpeg", "big.jpg")).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects a declared/detected mismatch", () => {
    const r = validateUpload(bytes(PNG_SIG, PNG_IEND), "image/jpeg", "x.jpg");
    expect(r).toEqual({ ok: false, reason: "mismatch" });
  });

  it("detects webp, avif and mp4 containers", () => {
    const webp = validateUpload(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp", "x.webp");
    expect(webp).toEqual({ ok: true, mime: "image/webp", ext: "webp" });

    const avif = validateUpload(bytes([0, 0, 0, 0x20], "ftypavif", [0, 0, 0, 0]), "image/avif", "x.avif");
    expect(avif).toEqual({ ok: true, mime: "image/avif", ext: "avif" });

    const mp4 = validateUpload(bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 0, 0]), "video/mp4", "x.mp4");
    expect(mp4).toEqual({ ok: true, mime: "video/mp4", ext: "mp4" });
  });

  it("rejects unknown/garbage bytes", () => {
    expect(validateUpload(bytes([0x00, 0x01, 0x02, 0x03]), "application/octet-stream", "x")).toEqual({ ok: false, reason: "unknown_type" });
  });
});
