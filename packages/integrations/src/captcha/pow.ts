import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type PowChallenge = { salt: string; bits: number; expiresAt: number; sig: string };
// DECISION: PowSolution carries `bits` (the header omitted it). Difficulty is variable (tests use 12,
// production 18) and verifySolution has no challenge to read it from; `bits` is bound into the HMAC
// sig, so a client cannot claim an easier difficulty than the challenge it was issued.
export type PowSolution = { salt: string; nonce: number; bits: number; expiresAt: number; sig: string };
export const POW_HEADER = "x-nl-pow";

export const POW_BITS_DEFAULT = 18;
export const POW_TTL_SEC_DEFAULT = 300;

function powSig(key: string, salt: string, bits: number, expiresAt: number, scope: string): string {
  return createHmac("sha256", key).update(`${salt}|${bits}|${expiresAt}|${scope}`).digest("hex");
}

function sha256HexSync(input: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(input).digest());
}

async function sha256HexWeb(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function issueChallenge(cfg: { key: string; bits?: number; ttlSec?: number }, scope: string): PowChallenge {
  const bits = cfg.bits ?? POW_BITS_DEFAULT;
  const ttlSec = cfg.ttlSec ?? POW_TTL_SEC_DEFAULT;
  const salt = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + ttlSec * 1000;
  return { salt, bits, expiresAt, sig: powSig(cfg.key, salt, bits, expiresAt, scope) };
}

export function verifySolution(
  cfg: { key: string },
  scope: string,
  s: PowSolution,
): { ok: boolean; reason?: "expired" | "sig" | "work" } {
  const expected = powSig(cfg.key, s.salt, s.bits, s.expiresAt, scope);
  const a = Buffer.from(expected);
  const b = Buffer.from(s.sig ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "sig" };
  if (Date.now() > s.expiresAt) return { ok: false, reason: "expired" };
  if (leadingZeroBits(sha256HexSync(`${s.salt}${s.nonce}`)) < s.bits) return { ok: false, reason: "work" };
  return { ok: true };
}

export async function solveInBrowser(c: PowChallenge): Promise<PowSolution> {
  let nonce = 0;
  // bounded loop guard: 18 bits ≈ 260k tries; the cap is far above any legitimate difficulty
  const cap = 1 << Math.min(c.bits + 8, 30);
  while (nonce < cap) {
    if (leadingZeroBits(await sha256HexWeb(`${c.salt}${nonce}`)) >= c.bits) break;
    nonce += 1;
  }
  return { salt: c.salt, nonce, bits: c.bits, expiresAt: c.expiresAt, sig: c.sig };
}
