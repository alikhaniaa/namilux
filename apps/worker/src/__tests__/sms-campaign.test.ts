import { describe, expect, it } from "vitest";
import { THROTTLE_MS, throttleMsFor } from "../handlers/sms-campaign";

describe("campaign pacing", () => {
  it("keeps the fan-out under the provider's per-minute cap", () => {
    // FarazSMS: 60/min. The old fixed 250 ms was 240/min, which would have turned most of a campaign
    // into 429s - so a declared limit has to win, with a little headroom over the exact interval.
    const ms = throttleMsFor(60);
    expect(ms).toBeGreaterThan(1_000);
    expect(60_000 / ms).toBeLessThan(60);
  });

  it("falls back to the fixed spacing when a provider declares no limit", () => {
    expect(throttleMsFor(undefined)).toBe(THROTTLE_MS);
    expect(throttleMsFor(0)).toBe(THROTTLE_MS);
  });

  it("never paces faster than the fixed floor, however generous the provider", () => {
    expect(throttleMsFor(100_000)).toBe(THROTTLE_MS);
  });
});
