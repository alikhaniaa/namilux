import { describe, expect, it } from "vitest";
import { EVENT_TYPES, UA_CLASSES } from "../../constants";
import {
  analyticsQuerySchema,
  beaconPropsSchema,
  beaconSchema,
  cspLegacyReportSchema,
  cspReportSchema,
  cspReportingApiSchema,
  dashboardRangeSchema,
} from "../analytics";

const S = "a".repeat(16);
const beacon = { t: "pv" as const, p: "/shop/", s: S, ua: "pwa" as const };

describe("beacon shape and caps", () => {
  it("accepts the minimal beacon and every documented enum member", () => {
    expect(beaconSchema.parse(beacon)).toEqual(beacon);
    for (const t of EVENT_TYPES) expect(beaconSchema.parse({ ...beacon, t }).t).toBe(t);
    for (const ua of UA_CLASSES) expect(beaconSchema.parse({ ...beacon, ua }).ua).toBe(ua);
    expect(beaconSchema.parse({ ...beacon, r: "https://www.google.com/", pid: "۱۰۴۴" }).pid).toBe(1044);
    expect(beaconSchema.parse({ ...beacon, p: "/فروشگاه/کتری-برقی/" }).p).toBe("/فروشگاه/کتری-برقی/");
  });

  it("refuses a relative path, a query string and a fragment", () => {
    for (const p of ["shop/", "", "/shop/?q=x", "/shop/#top", "/a b/", "https://namilux.ir/shop/", `/${"a".repeat(512)}`]) {
      expect(() => beaconSchema.parse({ ...beacon, p }), JSON.stringify(p)).toThrow();
    }
  });

  it("requires a 16..64 lowercase-hex session hash and a known ua class", () => {
    expect(beaconSchema.parse({ ...beacon, s: "f".repeat(64) }).s).toBe("f".repeat(64));
    for (const s of ["a".repeat(15), "a".repeat(65), "A".repeat(16), "g".repeat(16), "", 16]) {
      expect(() => beaconSchema.parse({ ...beacon, s }), JSON.stringify(s)).toThrow();
    }
    for (const ua of ["tablet", "", "MOBILE", null]) {
      expect(() => beaconSchema.parse({ ...beacon, ua }), JSON.stringify(ua)).toThrow();
    }
    for (const t of ["click", "", "PV"]) {
      expect(() => beaconSchema.parse({ ...beacon, t }), JSON.stringify(t)).toThrow();
    }
  });

  it("caps the props map at ten snake_case keys with small values", () => {
    expect(beaconPropsSchema.parse({ q: "کتری", step: 2, ok: true })).toEqual({ q: "کتری", step: 2, ok: true });
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(beaconPropsSchema.parse(ten)).length).toBe(10);
    expect(() => beaconPropsSchema.parse({ ...ten, k10: 10 })).toThrow();
    expect(() => beaconPropsSchema.parse({ "Bad-Key": 1 })).toThrow();
    expect(() => beaconPropsSchema.parse({ "": 1 })).toThrow();
    expect(() => beaconPropsSchema.parse({ [`k${"x".repeat(32)}`]: 1 })).toThrow();
    expect(() => beaconPropsSchema.parse({ q: "x".repeat(121) })).toThrow();
    expect(() => beaconPropsSchema.parse({ q: Infinity })).toThrow();
    expect(() => beaconPropsSchema.parse({ q: { nested: 1 } })).toThrow();
    expect(() => beaconPropsSchema.parse({ q: null })).toThrow();
    // an own __proto__ property is dropped by zod and never assigned to the prototype
    const polluted = beaconPropsSchema.parse(JSON.parse('{"__proto__":1}'));
    expect(Object.prototype.hasOwnProperty.call(polluted, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("is strict and carries no PII field", () => {
    for (const extra of [{ phone: "09121230077" }, { email: "a@b.ir" }, { name: "علی" }, { ip: "1.2.3.4" }, { extra: 1 }]) {
      expect(() => beaconSchema.parse({ ...beacon, ...extra }), JSON.stringify(extra)).toThrow();
    }
    expect(() => beaconSchema.parse({ ...beacon, r: "x".repeat(513) })).toThrow();
    expect(() => beaconSchema.parse({ ...beacon, pid: 0 })).toThrow();
    expect(() => beaconSchema.parse({ t: "pv", p: "/", s: S })).toThrow();
  });
});

describe("csp report shapes", () => {
  it("keeps unknown fields inside csp-report (browser-defined) but rejects a top-level extra key", () => {
    const report = {
      "csp-report": {
        "document-uri": "https://namilux.ir/shop/",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js",
        "line-number": 12,
        "future-field": "whatever",
      },
    };
    expect(cspLegacyReportSchema.parse(report)).toEqual(report);
    expect(cspReportSchema.parse(report)).toEqual(report);
    expect(() => cspLegacyReportSchema.parse({ ...report, extra: 1 })).toThrow();
    expect(() => cspLegacyReportSchema.parse({})).toThrow();
    expect(() =>
      cspLegacyReportSchema.parse({ "csp-report": { "original-policy": "x".repeat(4097) } }),
    ).toThrow();
    expect(() => cspLegacyReportSchema.parse({ "csp-report": { "line-number": "12" } })).toThrow();
  });

  it("accepts up to ten Reporting-API entries", () => {
    const entry = { type: "csp-violation" as const, age: 10, url: "https://namilux.ir/", body: { disposition: "enforce" } };
    expect(cspReportingApiSchema.parse([entry])).toEqual([entry]);
    expect(cspReportingApiSchema.parse(Array.from({ length: 10 }, () => entry)).length).toBe(10);
    expect(() => cspReportingApiSchema.parse(Array.from({ length: 11 }, () => entry))).toThrow();
    expect(() => cspReportingApiSchema.parse([{ ...entry, type: "deprecation" }])).toThrow();
    expect(() => cspReportingApiSchema.parse([{ ...entry, extra: 1 }])).toThrow();
    expect(() => cspReportingApiSchema.parse([{ type: "csp-violation" }])).toThrow();
    expect(cspReportSchema.parse([entry])).toEqual([entry]);
    expect(() => cspReportSchema.parse("nope")).toThrow();
  });
});

describe("dashboard range", () => {
  it("takes a preset or a bounded custom window", () => {
    for (const preset of ["today", "7d", "30d"]) expect(dashboardRangeSchema.parse(preset)).toBe(preset);
    expect(dashboardRangeSchema.parse({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    // DECISION (M0 lint): was `.toString()).toBeTruthy()` - "[object Object]" is truthy for any
    // object, so the case (a one-day window is accepted) was asserted by the parse not throwing.
    expect(dashboardRangeSchema.parse({ from: "2026-01-01", to: "2026-01-01" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-01",
    });
  });

  it("refuses an inverted window, a span over 400 days, and junk", () => {
    const inverted = dashboardRangeSchema.safeParse({ from: "2026-01-01", to: "2025-12-31" });
    expect(inverted.success).toBe(false);
    expect(() => dashboardRangeSchema.parse({ from: "2025-01-01", to: "2026-02-06" })).toThrow(); // 401 days
    expect(dashboardRangeSchema.parse({ from: "2025-01-01", to: "2026-02-05" })).toEqual({
      from: "2025-01-01",
      to: "2026-02-05",
    });
    for (const bad of ["90d", "", { from: "2026-01-01" }, { from: "2026-01-01", to: "2026-01-02", tz: "Asia/Tehran" }]) {
      expect(() => dashboardRangeSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("analyticsQuerySchema defaults to 7d and validates the metric", () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ range: "7d" });
    expect(analyticsQuerySchema.parse({ range: "today", metric: "funnel" })).toEqual({
      range: "today",
      metric: "funnel",
    });
    expect(() => analyticsQuerySchema.parse({ metric: "revenue" })).toThrow();
    expect(() => analyticsQuerySchema.parse({ range: "7d", page: 1 })).toThrow();
  });
});
