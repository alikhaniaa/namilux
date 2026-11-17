import { describe, expect, it } from "vitest";
import {
  DEFAULT_OTP_LIMITS,
  type QuotaRow,
  effectiveCount,
  evaluate,
  ipSlash24,
  limitForKey,
  otpLimitsSchema,
  quotaKeys,
  otpQuota,
  verifyKey,
} from "../quota";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const KEYS = quotaKeys({ phone: "09121230077", ip: "1.2.3.4", uaHash: "uahash" });
const [PHONE_10M, PHONE_1D, IP_10M, UA_1D, GLOBAL] = KEYS;

function row(key: string, count: number, ageMs = 0): QuotaRow {
  return { key, count, windowStart: new Date(NOW.getTime() - ageMs) };
}

describe("auth/quota - pure", () => {
  it("quotaKeys order and format are exact", () => {
    expect(KEYS).toEqual([
      "otp:phone:09121230077:10m",
      "otp:phone:09121230077:1d",
      "otp:ip:1.2.3.0/24:10m",
      "otp:ua:uahash:1d",
      "otp:global:10m",
    ]);
    expect(verifyKey("1.2.3.4")).toBe("otpv:ip:1.2.3.0/24:10m");
  });

  it("ipSlash24 maps v4, v6 and garbage", () => {
    expect(ipSlash24("10.0.0.255")).toBe("10.0.0.0/24");
    expect(ipSlash24("2001:0db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(ipSlash24("garbage")).toBe("0.0.0.0/24");
  });

  it.each([
    ["0/0/0/0 → ok", [], "ok"],
    ["2/2/2/2 → ok", [row(PHONE_10M!, 2), row(PHONE_1D!, 2), row(IP_10M!, 2), row(UA_1D!, 2)], "ok"],
    ["phone10m 3 → blocked", [row(PHONE_10M!, 3)], "blocked"],
    ["phone1d 6 → blocked", [row(PHONE_1D!, 6)], "blocked"],
    ["ip10m 20 → blocked", [row(IP_10M!, 20)], "blocked"],
    ["ua1d 10 → blocked", [row(UA_1D!, 10)], "blocked"],
    ["ip10m 3 → captcha", [row(IP_10M!, 3)], "captcha"],
    ["global 600 → blocked", [row(GLOBAL!, 600)], "blocked"],
  ] as const)("%s", (_label, rows, expected) => {
    expect(evaluate([...rows], KEYS, DEFAULT_OTP_LIMITS, NOW)).toBe(expected);
  });

  it("phone10m 3 with phonePer10m raised to 5 → captcha", () => {
    const limits = { ...DEFAULT_OTP_LIMITS, phonePer10m: 5 };
    expect(evaluate([row(PHONE_10M!, 3)], KEYS, limits, NOW)).toBe("captcha");
  });

  it("a row whose window has ended counts as 0", () => {
    expect(effectiveCount(row(PHONE_10M!, 99, 20 * 60_000), NOW)).toBe(0);
    expect(evaluate([row(PHONE_10M!, 99, 20 * 60_000)], KEYS, DEFAULT_OTP_LIMITS, NOW)).toBe("ok");
  });

  it("limitForKey covers every key class", () => {
    expect(limitForKey(GLOBAL!, DEFAULT_OTP_LIMITS)).toBe(600);
    expect(limitForKey(PHONE_10M!, DEFAULT_OTP_LIMITS)).toBe(3);
    expect(limitForKey(PHONE_1D!, DEFAULT_OTP_LIMITS)).toBe(6);
    expect(limitForKey(IP_10M!, DEFAULT_OTP_LIMITS)).toBe(20);
    expect(limitForKey(UA_1D!, DEFAULT_OTP_LIMITS)).toBe(10);
    expect(limitForKey(verifyKey("1.2.3.4"), DEFAULT_OTP_LIMITS)).toBe(30);
    expect(limitForKey("otp:unknown:x", DEFAULT_OTP_LIMITS)).toBeNull();
  });

  it("retryAfterSec: a phone:10m row started 4 min ago and blocking → 360, never below 1", () => {
    const rows = [row(PHONE_10M!, 3, 4 * 60_000)];
    expect(otpQuota.retryAfterSec(rows, KEYS, DEFAULT_OTP_LIMITS, NOW)).toBe(360);
    expect(otpQuota.retryAfterSec([], KEYS, DEFAULT_OTP_LIMITS, NOW)).toBe(1);
  });

  it("otpLimitsSchema rejects negatives and pauseMultiplier 0, accepts the defaults", () => {
    expect(otpLimitsSchema.safeParse(DEFAULT_OTP_LIMITS).success).toBe(true);
    expect(otpLimitsSchema.safeParse({ ...DEFAULT_OTP_LIMITS, phonePer10m: -1 }).success).toBe(false);
    expect(otpLimitsSchema.safeParse({ ...DEFAULT_OTP_LIMITS, pauseMultiplier: 0 }).success).toBe(false);
  });
});
