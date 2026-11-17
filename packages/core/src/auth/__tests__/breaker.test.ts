import { describe, expect, it } from "vitest";
import { DEFAULT_OTP_LIMITS } from "../quota";
import { breaker, breakerState } from "../breaker";

const limits = (global10m: number, pauseMultiplier: number) => ({
  ...DEFAULT_OTP_LIMITS,
  global10m,
  pauseMultiplier,
});

describe("auth/breaker - pure", () => {
  it.each([
    [0, 200, 3, "ok"],
    [200, 200, 3, "ok"],
    [201, 200, 3, "captcha"],
    [600, 200, 3, "captcha"],
    [601, 200, 3, "pause"],
    [1, 0, 3, "pause"],
    [201, 200, 1, "pause"],
  ] as const)("sends=%i global=%i mult=%i → %s", (sends, g, m, expected) => {
    expect(breakerState(sends, limits(g, m))).toBe(expected);
  });

  it("tenMinuteBucket dedupes within a 10-minute window and differs across it", () => {
    expect(breaker.tenMinuteBucket(new Date("2026-08-25T10:00:00Z"))).toBe(
      breaker.tenMinuteBucket(new Date("2026-08-25T10:09:59Z")),
    );
    expect(breaker.tenMinuteBucket(new Date("2026-08-25T10:00:00Z"))).not.toBe(
      breaker.tenMinuteBucket(new Date("2026-08-25T10:10:00Z")),
    );
  });
});
