import { describe, expect, it } from "vitest";
import { UPLOAD_MAX_BYTES, validateUpload } from "@namilux/integrations";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("security/upload - validateUpload", () => {
  it("accepts a real JPEG and PNG by magic bytes", () => {
    expect(validateUpload(JPEG, "image/jpeg", "a.jpg").ok).toBe(true);
    expect(validateUpload(PNG, "image/png", "a.png").ok).toBe(true);
  });

  it("rejects an SVG (script vector)", () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = validateUpload(svg, "image/svg+xml", "x.svg");
    expect(r.ok).toBe(false);
  });

  it("rejects a GIFAR-style polyglot (GIF header + zip trailer) and a magic/mime mismatch", () => {
    const polyglot = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x50, 0x4b, 0x03, 0x04]);
    expect(validateUpload(polyglot, "image/jpeg", "p.jpg").ok).toBe(false);
    expect(validateUpload(PNG, "image/jpeg", "lie.jpg").ok).toBe(false);
  });

  it("rejects oversize", () => {
    const big = new Uint8Array(UPLOAD_MAX_BYTES + 1);
    big.set(JPEG);
    expect(validateUpload(big, "image/jpeg", "big.jpg").ok).toBe(false);
  });
});
