import { describe, expect, it } from "vitest";
import {
  TOTP_DRIFT_STEPS,
  TOTP_STEP_SEC,
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  otpauthUri,
  totp,
  totpEncKeyFromHex,
  verifyTotp,
  verifyTotpStep,
} from "../totp";

const RFC_SECRET = new TextEncoder().encode("12345678901234567890"); // 20-byte ASCII, SHA-1 vectors

describe("auth/totp", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("matches RFC 6238 vector t=%i", (t, expected) => {
    expect(totp(RFC_SECRET, t * 1000)).toBe(expected);
  });

  it("verifyTotp accepts steps c-1 and c+1 and rejects c-2 and c+2 with window 1", () => {
    const now = Date.now();
    const step = 30_000;
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - step), 1)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + step), 1)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 2 * step), 1)).toBe(false);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 2 * step), 1)).toBe(false);
  });

  // The step-up («تأیید دوباره») runs the same verifier as the login step, with the same declared
  // drift: a code read at the end of one window and typed into the next has to be accepted there too.
  it("TOTP_DRIFT_STEPS is 1 and is what both TOTP paths use by default", () => {
    const now = Date.now();
    const step = TOTP_STEP_SEC * 1000;
    expect(TOTP_DRIFT_STEPS).toBe(1);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - step))).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + step))).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 2 * step))).toBe(false);
  });

  // The single-use guard has to key on the step the CODE belongs to, not on the wall clock: two
  // verifications inside one 30-second window are ordinary, two uses of one code are not.
  it("verifyTotpStep names the matching step across the whole window and null otherwise", () => {
    const now = Date.now();
    const step = TOTP_STEP_SEC * 1000;
    const here = Math.floor(now / 1000 / TOTP_STEP_SEC);
    expect(verifyTotpStep(RFC_SECRET, totp(RFC_SECRET, now))).toBe(here);
    expect(verifyTotpStep(RFC_SECRET, totp(RFC_SECRET, now - step))).toBe(here - 1);
    expect(verifyTotpStep(RFC_SECRET, totp(RFC_SECRET, now + step))).toBe(here + 1);
    expect(verifyTotpStep(RFC_SECRET, totp(RFC_SECRET, now - 2 * step))).toBeNull();
    expect(verifyTotpStep(RFC_SECRET, "not-a-code")).toBeNull();
  });

  it("verifyTotp with window 0 rejects c-1 and c+1", () => {
    const now = Date.now();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), 0)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 30_000), 0)).toBe(false);
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now + 30_000), 0)).toBe(false);
  });

  it("verifies a Persian-digit code", () => {
    const now = Date.now();
    const code = totp(RFC_SECRET, now);
    const persian = code.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
    expect(verifyTotp(RFC_SECRET, persian, 1)).toBe(true);
  });

  it("rejects malformed codes", () => {
    for (const bad of ["28708", "2870822", "28708a", ""]) {
      expect(verifyTotp(RFC_SECRET, bad, 1)).toBe(false);
    }
  });

  it("base32 round-trips 0, 1, 5, 20 and 33 bytes", () => {
    for (const n of [0, 1, 5, 20, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_v, i) => (i * 37 + 11) & 0xff);
      expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it("base32Decode is case-insensitive, tolerates '=' and throws on '1'/'8'", () => {
    const enc = base32Encode(RFC_SECRET);
    expect(Array.from(base32Decode(enc.toLowerCase()))).toEqual(Array.from(base32Decode(enc)));
    expect(() => base32Decode(`${enc}=`)).not.toThrow();
    expect(() => base32Decode("1")).toThrow();
    expect(() => base32Decode("8")).toThrow();
  });

  it("otpauthUri percent-encodes the label and carries the algorithm params", () => {
    const uri = otpauthUri(RFC_SECRET, "owner name@namilux.ir");
    expect(uri).toContain("otpauth://totp/NAMILUX%3Aowner%20name%40namilux.ir");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("encrypt → decrypt round-trips and fails closed on tampering", () => {
    const key = totpEncKeyFromHex("a".repeat(64));
    const enc = encryptTotpSecret(RFC_SECRET, key);
    expect(Array.from(decryptTotpSecret(enc, key))).toEqual(Array.from(RFC_SECRET));

    const parts = enc.split(".");
    const ctBuf = Buffer.from(parts[2]!, "base64url");
    ctBuf[0]! ^= 0xff;
    parts[2] = ctBuf.toString("base64url");
    expect(() => decryptTotpSecret(parts.join("."), key)).toThrow();

    const wrongKey = totpEncKeyFromHex("b".repeat(64));
    expect(() => decryptTotpSecret(enc, wrongKey)).toThrow();
    expect(() => decryptTotpSecret(enc.replace(/^v1\./, "v2."), key)).toThrow();
  });

  it("two encryptions of the same secret differ (fresh IV)", () => {
    const key = totpEncKeyFromHex("c".repeat(64));
    expect(encryptTotpSecret(RFC_SECRET, key)).not.toBe(encryptTotpSecret(RFC_SECRET, key));
  });

  it("totpEncKeyFromHex rejects 63 chars, non-hex and empty input", () => {
    expect(() => totpEncKeyFromHex("a".repeat(63))).toThrow();
    expect(() => totpEncKeyFromHex("z".repeat(64))).toThrow();
    expect(() => totpEncKeyFromHex("")).toThrow();
  });

  it("generateTotpSecret returns 20 bytes and differs between calls", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(20);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
