import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { appError } from "../errors";

export const SCRYPT_PARAMS = {
  N: 131072,
  r: 8,
  p: 1,
  keylen: 32,
  saltBytes: 16,
  maxmem: 268435456,
} as const;

export type PasswordReason = "short" | "long" | "breached";

export const PASSWORD_FA: Record<PasswordReason, string> = {
  short: "گذرواژه باید دست‌کم ۱۲ نویسه باشد",
  long: "گذرواژه بیش از حد بلند است",
  breached: "این گذرواژه در فهرست گذرواژه‌های لو رفته است؛ گذرواژهٔ دیگری انتخاب کنید",
};

const MIN_LEN = 12;
const MAX_LEN = 128;

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

function scrypt(pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(pw, salt, keylen, opts, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const len = codePoints(pw);
  if (len === 0) throw appError("VALIDATION", { fa: PASSWORD_FA.short });
  if (len > MAX_LEN) throw appError("VALIDATION", { fa: PASSWORD_FA.long });
  const { N, r, p, keylen, saltBytes, maxmem } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await scrypt(pw, salt, keylen, { N, r, p, maxmem });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

function parseHash(hash: string): ParsedHash | null {
  const parts = hash.split("$");
  if (parts.length !== 6) return null;
  const [algo, nStr, rStr, pStr, saltB64, keyB64] = parts;
  if (algo !== "scrypt") return null;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!isPowerOfTwo(N) || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) return null;
  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(saltB64 ?? "", "base64url");
    key = Buffer.from(keyB64 ?? "", "base64url");
  } catch {
    return null;
  }
  if (salt.length === 0 || key.length === 0) return null;
  // reject non-base64url characters (Buffer.from is lenient) by round-tripping
  if (salt.toString("base64url") !== saltB64 || key.toString("base64url") !== keyB64) return null;
  return { N, r, p, salt, key };
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    if (codePoints(pw) > MAX_LEN) return false;
    const parsed = parseHash(hash);
    if (parsed === null) return false;
    const { N, r, p, salt, key } = parsed;
    const maxmem = 128 * N * r * 2;
    const candidate = await scrypt(pw, salt, key.length, { N, r, p, maxmem });
    if (candidate.length !== key.length) return false;
    return timingSafeEqual(candidate, key);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  const parsed = parseHash(hash);
  if (parsed === null) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

/**
 * A one-time password the owner hands to a new staff member. 20 characters from an unambiguous
 * alphabet (no O/0, l/1/I) so it survives being read aloud or copied off a screen once, and long
 * enough that `isAcceptablePassword` accepts it without a breach list. Never logged: the caller
 * returns it in one response and it is stored only as a scrypt hash.
 */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export const GENERATED_PASSWORD_LEN = 20;

export function generateStaffPassword(): string {
  const alphabet = PASSWORD_ALPHABET;
  // Rejection sampling: a plain `byte % 56` would make the first 32 letters slightly likelier.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < GENERATED_PASSWORD_LEN) {
    for (const b of randomBytes(GENERATED_PASSWORD_LEN)) {
      if (b >= limit) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === GENERATED_PASSWORD_LEN) break;
    }
  }
  return out;
}

export function isAcceptablePassword(
  pw: string,
  breached: ReadonlySet<string>,
): { ok: true } | { ok: false; reason: PasswordReason } {
  const len = codePoints(pw);
  if (len < MIN_LEN) return { ok: false, reason: "short" };
  if (len > MAX_LEN) return { ok: false, reason: "long" };
  if (breached.has(pw.toLowerCase())) return { ok: false, reason: "breached" };
  return { ok: true };
}
