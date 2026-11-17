import { describe, expect, it, vi } from "vitest";

import { ORDER_CODE_RE } from "../constants";
import {
  CROCKFORD,
  isUlid,
  orderCode,
  randomToken,
  shortCode,
  ulid,
  ulidTime,
  ULID_RE,
  UNAMBIGUOUS_ALPHABET,
} from "../ids";

describe("ids", () => {
  it("ulid shape", () => {
    for (let i = 0; i < 200; i++) {
      const id = ulid();
      expect(id).toHaveLength(26);
      expect(ULID_RE.test(id)).toBe(true);
      expect(isUlid(id)).toBe(true);
      for (const ch of id) expect(CROCKFORD.includes(ch)).toBe(true);
    }
    expect(isUlid("")).toBe(false);
    expect(isUlid(ulid().toLowerCase())).toBe(false);
    expect(isUlid(ulid().slice(0, 25))).toBe(false);
    // I, L, O and U are not Crockford symbols
    expect(isUlid("0IJKMNPQRSTVWXYZ0123456789")).toBe(false);
  });

  it("ulid monotonic within ms", () => {
    const now = 1_800_000_000_000;
    const a = ulid(now);
    const b = ulid(now);
    const c = ulid(now);
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
    expect(b.slice(0, 10)).toBe(a.slice(0, 10));
    expect(b).toHaveLength(26);
    // a clock that goes backwards never produces a smaller id (rules)
    const d = ulid(now - 60_000);
    expect(d.slice(0, 10)).toBe(a.slice(0, 10));
    expect(d > c).toBe(true);
  });

  it("ulid time roundtrip", async () => {
    vi.resetModules();
    const fresh = await import("../ids");
    expect(fresh.ulidTime(fresh.ulid(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(fresh.ulidTime(fresh.ulid(1_700_000_000_001))).toBe(1_700_000_000_001);
    expect(ulidTime("00000000000000000000000000")).toBe(0);
    expect(() => ulidTime("nope")).toThrow(RangeError);
    expect(() => ulidTime("")).toThrow(RangeError);
  });

  it("ulid rejects out-of-range time", () => {
    expect(() => ulid(2 ** 48)).toThrow(RangeError);
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(Number.NaN)).toThrow(RangeError);
    expect(() => ulid(1.5)).toThrow(RangeError);
    expect(() => ulid(2 ** 48 - 1)).not.toThrow();
  });

  it("orderCode shape and alphabet", () => {
    // U *is* in UNAMBIGUOUS_ALPHABET - only 0, O, 1, I and L are excluded (ids.ts edge cases)
    const forbidden = ["0", "O", "1", "I", "L"];
    const seen = new Set<string>();
    // 10 000 codes × 4 assertions each is 40 000 `expect` calls, which alone costs more than the
    // 5 s test timeout under a parallel run - collect the violations and assert once instead.
    const badShape: string[] = [];
    const badChars: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const code = orderCode();
      if (!ORDER_CODE_RE.test(code) || !code.startsWith("NL-") || code.length !== 8) badShape.push(code);
      for (const ch of code.slice(3)) {
        if (!UNAMBIGUOUS_ALPHABET.includes(ch)) badChars.push(ch);
        seen.add(ch);
      }
    }
    expect(badShape).toEqual([]);
    expect(badChars).toEqual([]);
    for (const ch of forbidden) expect(seen.has(ch)).toBe(false);
    // rejection sampling reaches the whole alphabet
    expect(seen.size).toBe(UNAMBIGUOUS_ALPHABET.length);
  });

  it("shortCode length and bounds", () => {
    expect(shortCode(8)).toHaveLength(8);
    expect(shortCode(4)).toHaveLength(4);
    expect(shortCode(32)).toHaveLength(32);
    for (const ch of shortCode(32)) expect(UNAMBIGUOUS_ALPHABET.includes(ch)).toBe(true);
    expect(() => shortCode(3)).toThrow(RangeError);
    expect(() => shortCode(33)).toThrow(RangeError);
    expect(() => shortCode(4.5)).toThrow(RangeError);
  });

  it("randomToken hex", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken(64)).toMatch(/^[0-9a-f]{128}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(() => randomToken(15)).toThrow(RangeError);
    expect(() => randomToken(65)).toThrow(RangeError);
    expect(() => randomToken(32.5)).toThrow(RangeError);
  });
});
