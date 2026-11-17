import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appError } from "../errors";
import { enDigits } from "../persian";

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = "NAMILUX";

const CODE_RE = /^\d{6}$/;
const DIGIT_MOD = 1_000_000;

function counterBytes(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

function hotp(secret: Uint8Array, counter: number): string {
  const hmac = createHmac("sha1", Buffer.from(secret)).update(counterBytes(counter)).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const bin =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(bin % DIGIT_MOD).padStart(TOTP_DIGITS, "0");
}

export function totp(secret: Uint8Array, at?: number): string {
  const ms = at ?? Date.now();
  const counter = Math.floor(ms / 1000 / TOTP_STEP_SEC);
  return hotp(secret, counter);
}

/**
 * The drift both TOTP paths allow - login AND the step-up (sudo) re-check. One step either side of
 * now is RFC 6238 §5.2's own suggestion: it covers the code a person read at the end of a window
 * and typed into the next one, which is the ordinary case, not an edge case.
 */
export const TOTP_DRIFT_STEPS = 1;

/**
 * The step whose code matches, or null. Callers that keep a single-use guard need the step the CODE
 * belongs to - keying that guard on the wall clock instead rejects a perfectly good code whenever
 * another verification for the same account happened to land in the same 30-second window.
 */
export function verifyTotpStep(secret: Uint8Array, code: string, window = TOTP_DRIFT_STEPS): number | null {
  const folded = enDigits(code).trim();
  if (!CODE_RE.test(folded)) return null;
  const codeBuf = Buffer.from(folded, "utf8");
  const c = Math.floor(Date.now() / 1000 / TOTP_STEP_SEC);
  const w = Number.isInteger(window) && window >= 0 ? window : TOTP_DRIFT_STEPS;
  let matched: number | null = null;
  for (let i = -w; i <= w; i += 1) {
    const candidate = Buffer.from(hotp(secret, c + i), "utf8");
    // constant-time compare; never break early so timing does not leak which step matched
    if (candidate.length === codeBuf.length && timingSafeEqual(candidate, codeBuf)) matched = c + i;
  }
  return matched;
}

export function verifyTotp(secret: Uint8Array, code: string, window = TOTP_DRIFT_STEPS): boolean {
  return verifyTotpStep(secret, code, window) !== null;
}

export function generateTotpSecret(): Uint8Array {
  return randomBytes(TOTP_SECRET_BYTES);
}

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw appError("VALIDATION", { fa: "کلید معتبر نیست" });
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function otpauthUri(secret: Uint8Array, accountEmail: string, issuer = TOTP_ISSUER): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

const ENC_VERSION = "v1";
const ENC_AAD = Buffer.from("totp:v1");

export function encryptTotpSecret(secret: Uint8Array, key: Uint8Array): string {
  if (key.length !== 32) throw appError("INTERNAL", { fa: "خطای داخلی" });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), iv, { authTagLength: 16 });
  cipher.setAAD(ENC_AAD);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_VERSION}.${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptTotpSecret(enc: string, key: Uint8Array): Uint8Array {
  try {
    if (key.length !== 32) throw new Error("bad key");
    const parts = enc.split(".");
    if (parts.length !== 4 || parts[0] !== ENC_VERSION) throw new Error("bad format");
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const ct = Buffer.from(parts[2] ?? "", "base64url");
    const tag = Buffer.from(parts[3] ?? "", "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("bad lengths");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), iv, { authTagLength: 16 });
    decipher.setAAD(ENC_AAD);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return Uint8Array.from(pt);
  } catch {
    throw appError("INTERNAL", { fa: "خطای داخلی" });
  }
}

export function totpEncKeyFromHex(hex: string): Uint8Array {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw appError("INTERNAL", { details: "TOTP_ENC_KEY must be 64 hex chars" });
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}
