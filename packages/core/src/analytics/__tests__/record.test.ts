import { describe, expect, it } from "vitest";
import { classifyUa, dayKey } from "../record";

describe("analytics/record - classifyUa (pure)", () => {
  it("classifies pwa/inapp/mobile/desktop", () => {
    expect(classifyUa("anything", true)).toBe("pwa");
    expect(classifyUa("Mozilla Instagram 250.0", false)).toBe("inapp");
    expect(classifyUa("iPhone; Mobile Safari", false)).toBe("mobile");
    expect(classifyUa("Windows NT 10.0; Chrome", false)).toBe("desktop");
  });
  it("dayKey is YYYY-MM-DD", () => {
    expect(dayKey(new Date("2026-08-28T20:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
