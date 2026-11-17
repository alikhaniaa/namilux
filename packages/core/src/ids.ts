import { randomBytes } from "node:crypto";

import { ORDER_CODE_PREFIX, UNAMBIGUOUS_ALPHABET, ULID_RE } from "./constants";
import { appError } from "./errors";

export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Re-exported so callers validating codes do not need ./constants. */
export { UNAMBIGUOUS_ALPHABET, ULID_RE };

// ---------------------------------------------------------------- internals
const TIME_LEN = 10;
const RANDOM_LEN_BYTES = 10;
const MAX_ULID_TIME = 2 ** 48 - 1;
const ULID_LEN = 26;
/** Largest multiple of the alphabet size that fits in a byte (31 × 8 = 248) - see rules. */
const REJECTION_LIMIT = 256 - (256 % UNAMBIGUOUS_ALPHABET.length);

/** The only module state (rules): the monotonic guard of ulid(). */
let lastTime = -1;
let lastRandom: Uint8Array = new Uint8Array(RANDOM_LEN_BYTES);

/** 48-bit ms timestamp → 10 Crockford chars, big-endian. */
function encodeTime(time: number): string {
  const out = new Array<string>(TIME_LEN);
  let rest = time;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out[i] = CROCKFORD.charAt(rest % 32);
    rest = Math.floor(rest / 32);
  }
  return out.join("");
}

/** 10 random bytes (80 bits) → exactly 16 Crockford chars. */
function encodeRandom(bytes: Uint8Array): string {
  let acc = 0;
  let bits = 0;
  let out = "";
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD.charAt((acc >>> bits) & 31);
    }
  }
  return out;
}

/** +1 on the 80-bit random part, carrying across bytes; never mutates the input. */
function incrementRandom(bytes: Uint8Array): Uint8Array {
  const next = Uint8Array.from(bytes);
  for (let i = next.length - 1; i >= 0; i--) {
    const cur = next[i] ?? 0;
    if (cur < 255) {
      next[i] = cur + 1;
      return next;
    }
    next[i] = 0;
  }
  throw appError("INTERNAL", {
    details: "ulid: monotonic randomness exhausted inside one millisecond",
  });
}

/** Unbiased draw from UNAMBIGUOUS_ALPHABET - rejection sampling, never Math.random. */
function draw(len: number): string {
  const size = UNAMBIGUOUS_ALPHABET.length;
  let out = "";
  while (out.length < len) {
    // A byte is rejected with probability 8/256, so 2n + 8 bytes almost always suffice.
    for (const b of randomBytes((len - out.length) * 2 + 8)) {
      if (b >= REJECTION_LIMIT) continue;
      out += UNAMBIGUOUS_ALPHABET.charAt(b % size);
      if (out.length === len) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- contract
export function ulid(now?: number): string {
  const t = now ?? Date.now();
  // DECISION: a non-integer `now` is a caller bug, not a clock value - reject it instead of
  // truncating silently (the spec fixes the 0..2^48−1 range).
  if (!Number.isInteger(t) || t < 0 || t > MAX_ULID_TIME) {
    throw new RangeError(`ulid: time must be an integer in 0..${MAX_ULID_TIME}`);
  }
  if (t <= lastTime) {
    lastRandom = incrementRandom(lastRandom);
  } else {
    lastTime = t;
    lastRandom = Uint8Array.from(randomBytes(RANDOM_LEN_BYTES));
  }
  return encodeTime(lastTime) + encodeRandom(lastRandom);
}

export function isUlid(s: string): boolean {
  return typeof s === "string" && s.length === ULID_LEN && ULID_RE.test(s);
}

export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new RangeError("ulidTime: not a ULID");
  let time = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const idx = CROCKFORD.indexOf(id.charAt(i));
    if (idx < 0) throw new RangeError("ulidTime: not a ULID");
    time = time * 32 + idx;
  }
  return time;
}

export function orderCode(): string {
  return ORDER_CODE_PREFIX + draw(5);
}

export function shortCode(len: number): string {
  if (!Number.isInteger(len) || len < 4 || len > 32) {
    throw new RangeError("shortCode: len must be an integer in 4..32");
  }
  return draw(len);
}

export function randomToken(bytes?: number): string {
  const n = bytes ?? 32;
  if (!Number.isInteger(n) || n < 16 || n > 64) {
    throw new RangeError("randomToken: bytes must be an integer in 16..64");
  }
  return randomBytes(n).toString("hex");
}
