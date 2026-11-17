import { describe, expect, it } from "vitest";
import type { ShippingMethod } from "../shipping";
import {
  PROVINCE_ETA_BANDS,
  TEHRAN_NEIGHBOURS,
  cheapestOption,
  etaForProvince,
  provinceCode,
  shippingOptions,
} from "../shipping";

// The seeded ShippingMethod.key set is closed (ShippingMethodKey); test fixtures use free-form keys,
// so the helper takes a string and casts when assembling the fixture.
function method(over: { key: string; kind: ShippingMethod["kind"] } & Partial<Omit<ShippingMethod, "key" | "kind">>): ShippingMethod {
  return {
    id: 1,
    name: over.key,
    description: "",
    rate: {},
    provinces: null,
    etaMinDays: 2,
    etaMaxDays: 7,
    isActive: true,
    sort: 0,
    ...over,
    key: over.key as ShippingMethod["key"],
  };
}

const free = method({ key: "free_nationwide", kind: "free", etaMinDays: 2, etaMaxDays: 7 });

describe("pricing/shipping", () => {
  it("free_nationwide eta bands per province and unknown → Tehran", () => {
    expect(etaForProvince(free, "THR")).toEqual({ min: 2, max: 3 });
    expect(etaForProvince(free, "ABZ")).toEqual({ min: 2, max: 4 });
    expect(etaForProvince(free, "FRS")).toEqual({ min: 4, max: 7 });
    expect(etaForProvince(free, "تهران")).toEqual({ min: 2, max: 3 });
    expect(etaForProvince(free, "تهرآن")).toEqual({ min: 2, max: 3 });
  });

  it("express_tehran flat, THR only", () => {
    const m = method({ key: "express_tehran", kind: "flat", rate: { flat: 150_000 }, provinces: ["THR"], etaMinDays: 0, etaMaxDays: 1 });
    const thr = shippingOptions([m], "THR", 10_000_000);
    expect(thr).toEqual([{ key: "express_tehran", name: "express_tehran", cost: 150_000, etaMin: 0, etaMax: 1 }]);
    expect(shippingOptions([m], "ESF", 10_000_000)).toEqual([]);
  });

  it("flat with freeAbove crosses the threshold", () => {
    const m = method({ key: "flat", kind: "flat", rate: { flat: 200_000, freeAbove: 50_000_000 }, etaMinDays: 1, etaMaxDays: 3 });
    expect(shippingOptions([m], "THR", 50_000_000)[0]!.cost).toBe(0);
    expect(shippingOptions([m], "THR", 49_999_999)[0]!.cost).toBe(200_000);
  });

  it("by_province without a flat skips provinces with no rate", () => {
    const m = method({ key: "post", kind: "by_province", rate: { byProvince: { THR: 0, ESF: 90_000 } } });
    expect(shippingOptions([m], "ESF", 1_000)[0]!.cost).toBe(90_000);
    expect(shippingOptions([m], "KHZ", 1_000)).toEqual([]);
  });

  it("inactive method is never offered", () => {
    expect(shippingOptions([method({ key: "x", kind: "free", isActive: false })], "THR", 0)).toEqual([]);
  });

  it("pickup → cost 0 and its configured eta", () => {
    const m = method({ key: "pickup", kind: "pickup", etaMinDays: 0, etaMaxDays: 0 });
    expect(shippingOptions([m], "FRS", 0)).toEqual([{ key: "pickup", name: "pickup", cost: 0, etaMin: 0, etaMax: 0 }]);
  });

  it("orders by sort asc, then cost asc, then key", () => {
    const a = method({ key: "b_cheap", kind: "flat", rate: { flat: 100 }, sort: 1 });
    const b = method({ key: "a_dear", kind: "flat", rate: { flat: 500 }, sort: 1 });
    const c = method({ key: "first", kind: "free", sort: 0 });
    const keys = shippingOptions([a, b, c], "THR", 0).map((o) => o.key);
    expect(keys).toEqual(["first", "b_cheap", "a_dear"]);
  });

  it("band clamps into the method's own eta window", () => {
    expect(etaForProvince(method({ key: "m", kind: "free", etaMinDays: 3, etaMaxDays: 5 }), "THR")).toEqual({ min: 3, max: 3 });
    // band 4–7 (far) with method 1–3 → min>max → falls back to the method window
    expect(etaForProvince(method({ key: "m", kind: "free", etaMinDays: 1, etaMaxDays: 3 }), "FRS")).toEqual({ min: 1, max: 3 });
  });

  it("provinceCode normalizes codes and names", () => {
    expect(provinceCode("thr")).toBe("THR");
    expect(provinceCode("البرز")).toBe("ABZ");
    expect(provinceCode("")).toBeNull();
  });

  it("cheapestOption", () => {
    expect(cheapestOption([])).toBeNull();
    const opts = [
      { key: "a", name: "a", cost: 500, etaMin: 1, etaMax: 2 },
      { key: "b", name: "b", cost: 100, etaMin: 1, etaMax: 2 },
    ];
    expect(cheapestOption(opts)?.key).toBe("b");
  });

  it("constants match the spec", () => {
    expect(TEHRAN_NEIGHBOURS).toEqual(["ABZ", "QHM", "MKZ", "SMN", "MZN", "GZN"]);
    expect(PROVINCE_ETA_BANDS).toEqual({ tehran: { min: 1, max: 3 }, neighbour: { min: 2, max: 4 }, far: { min: 4, max: 7 } });
  });
});
