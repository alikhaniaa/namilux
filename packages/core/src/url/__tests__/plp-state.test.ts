import { describe, expect, it, vi } from "vitest";

// DECISION: ../persian/* is owned by other modules and not yet built when this was written; mocking the two helpers
// with their documented behaviour keeps this a unit test of plp-state.ts.
vi.mock("../../persian/format", () => ({
  enDigits: (s: string): string =>
    s.replace(/[۰-۹٠-٩]/g, (d) => {
      const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
      return String(fa === -1 ? "٠١٢٣٤٥٦٧٨٩".indexOf(d) : fa);
    }),
}));
vi.mock("../../persian/normalize", () => ({
  stripControl: (s: string): string =>
    [...s].filter((ch) => { const c = ch.codePointAt(0) ?? 0; return c > 0x1f && (c < 0x7f || c > 0x9f); }).join(""),
}));

import {
  PLP_DEFAULTS,
  PLP_MAX_VALUES_PER_FACET,
  PLP_MAX_VALUE_LEN,
  activeFilterCount,
  canonicalPlpUrl,
  isDefaultPlpState,
  isIndexablePlpState,
  normalizePlpState,
  parsePlpState,
  plpUrl,
  withoutFilter,
} from "../plp-state";
import type { PlpState } from "../plp-state";
import { AVAIL_FILTERS, PLP_MAX_PAGE, SORT_KEYS } from "../../constants";

const parse = (query: string): PlpState => parsePlpState(new URL(`https://namilux.ir/shop/${query}`).searchParams);
const roundTrip = (base: string, state: PlpState): PlpState =>
  parsePlpState(new URL(plpUrl(base, state), "https://namilux.ir").searchParams);

describe("plpUrl omits defaults", () => {
  it("returns the base unchanged for an empty state", () => {
    expect(plpUrl("/shop/", {})).toBe("/shop/");
  });

  it("returns the base unchanged for the default sort/page/density", () => {
    expect(plpUrl("/shop/", { page: 1, sort: "recommended", density: 3 })).toBe("/shop/");
    expect(plpUrl("/shop/", PLP_DEFAULTS)).toBe("/shop/");
  });

  it("drops empty arrays, blank values and out-of-range page/density", () => {
    expect(plpUrl("/shop/", { brand: [], color: ["", "   "], attr: {} })).toBe("/shop/");
    expect(plpUrl("/shop/", { page: 0 })).toBe("/shop/");
    expect(plpUrl("/shop/", { page: PLP_MAX_PAGE + 1 })).toBe("/shop/");
    expect(plpUrl("/shop/", { page: 2.5 })).toBe("/shop/");
    expect(plpUrl("/shop/", { density: 4 as unknown as 3 })).toBe("/shop/");
  });

  it("enforces the trailing slash on the base", () => {
    expect(plpUrl("/shop", { page: 2 })).toBe("/shop/?page=2");
    expect(plpUrl("/shop", {})).toBe("/shop/");
  });
});

describe("plpUrl param order and encoding", () => {
  it("sorts multi-values, dedupes them and keeps the documented param order", () => {
    expect(plpUrl("/shop/", { brand: ["smeg", "dyson", "smeg"], sort: "price_asc", page: 2 })).toBe(
      "/shop/?brand=dyson,smeg&sort=price_asc&page=2",
    );
  });

  it("encodes each value with lowercase hex, keeping the comma separator literal", () => {
    expect(plpUrl("/shop/", { color: ["مشکی"] })).toBe("/shop/?color=%d9%85%d8%b4%da%a9%db%8c");
    expect(plpUrl("/shop/", { color: ["a,b"] })).toBe("/shop/?color=a%2cb");
  });

  it("serializes open-ended and closed price ranges", () => {
    expect(plpUrl("/shop/", { priceMin: 1000000 })).toBe("/shop/?price=1000000-");
    expect(plpUrl("/shop/", { priceMax: 5000000 })).toBe("/shop/?price=-5000000");
    expect(plpUrl("/shop/", { priceMin: 1000000, priceMax: 5000000 })).toBe("/shop/?price=1000000-5000000");
  });

  it("drops an inconsistent or non-integer price pair entirely", () => {
    expect(plpUrl("/shop/", { priceMin: 5000000, priceMax: 1000000 })).toBe("/shop/");
    expect(plpUrl("/shop/", { priceMin: -1 })).toBe("/shop/");
    expect(plpUrl("/shop/", { priceMax: 1.5 })).toBe("/shop/");
  });

  it("sorts attr keys ASCII and drops keys that are not /^[a-z0-9_]{1,32}$/", () => {
    expect(plpUrl("/shop/", { attr: { wattage: ["1500"], color_family: ["red"] } })).toBe(
      "/shop/?attr.color_family=red&attr.wattage=1500",
    );
    expect(plpUrl("/shop/", { attr: { "Bad Key": ["1"] } })).toBe("/shop/");
  });

  it("orders avail by the AVAIL_FILTERS enum and dedupes", () => {
    expect(plpUrl("/shop/", { avail: ["ready", "in", "in"] })).toBe("/shop/?avail=in,ready");
    expect(plpUrl("/shop/", { avail: [...AVAIL_FILTERS] })).toBe("/shop/?avail=in,sale,ready");
  });

  it("emits every param in the documented order at once", () => {
    const url = plpUrl("/shop/", {
      brand: ["smeg"],
      collection: ["gifts"],
      color: ["red"],
      priceMin: 1,
      priceMax: 2,
      avail: ["in"],
      attr: { wattage: ["1500"] },
      sort: "newest",
      page: 3,
      density: 5,
    });
    expect(url).toBe(
      "/shop/?brand=smeg&collection=gifts&color=red&price=1-2&avail=in&attr.wattage=1500&sort=newest&page=3&density=5",
    );
  });

  it("sorts ASCII values by code point and Persian values with the fa collator", () => {
    const url = plpUrl("/shop/", { color: ["مشکی", "زرد", "black", "amber"] });
    const values = (url.split("color=")[1] ?? "").split(",");
    expect(values.slice(0, 2)).toEqual(["amber", "black"]);
    expect(values).toHaveLength(4);
  });

  it("caps a facet at PLP_MAX_VALUES_PER_FACET values and drops over-long ones", () => {
    const many = Array.from({ length: PLP_MAX_VALUES_PER_FACET + 5 }, (_, i) => `b${String(i).padStart(2, "0")}`);
    const emitted = (plpUrl("/shop/", { brand: many }).split("brand=")[1] ?? "").split(",");
    expect(emitted).toHaveLength(PLP_MAX_VALUES_PER_FACET);
    expect(plpUrl("/shop/", { brand: ["x".repeat(PLP_MAX_VALUE_LEN + 1)] })).toBe("/shop/");
    expect(plpUrl("/shop/", { brand: ["x".repeat(PLP_MAX_VALUE_LEN)] })).toBe(`/shop/?brand=${"x".repeat(PLP_MAX_VALUE_LEN)}`);
  });
});

describe("parsePlpState tolerant table", () => {
  it("merges repeated keys, dedupes and sorts", () => {
    expect(parse("?brand=smeg&brand=dyson&brand=smeg")).toEqual({ brand: ["dyson", "smeg"] });
    expect(parse("?brand=smeg,dyson")).toEqual({ brand: ["dyson", "smeg"] });
  });

  it("folds Persian digits before parsing page", () => {
    expect(parse("?page=۳")).toEqual({ page: 3 });
  });

  it("drops an out-of-range, non-numeric or default page", () => {
    expect(parse("?page=0")).toEqual({});
    expect(parse("?page=abc")).toEqual({});
    expect(parse("?page=999999")).toEqual({});
    expect(parse("?page=1")).toEqual({});
    expect(parse("?page=3.7")).toEqual({});
    expect(parse(`?page=${PLP_MAX_PAGE}`)).toEqual({ page: PLP_MAX_PAGE });
  });

  it("drops the whole price filter when it is inconsistent or malformed", () => {
    expect(parse("?price=5000000-1000000")).toEqual({});
    expect(parse("?price=-")).toEqual({});
    expect(parse("?price=abc-1")).toEqual({});
    expect(parse("?price=1-2-3")).toEqual({});
    expect(parse("?price=1000000-")).toEqual({ priceMin: 1000000 });
    expect(parse("?price=-5000000")).toEqual({ priceMax: 5000000 });
    expect(parse("?price=۱۰۰۰-۲۰۰۰")).toEqual({ priceMin: 1000, priceMax: 2000 });
  });

  it("validates sort, density and avail against the constants", () => {
    expect(parse("?sort=cheapest")).toEqual({});
    expect(parse("?sort=recommended")).toEqual({});
    expect(parse("?sort=price_desc")).toEqual({ sort: "price_desc" });
    expect(parse("?density=4")).toEqual({});
    expect(parse("?density=3")).toEqual({});
    expect(parse("?density=5")).toEqual({ density: 5 });
    expect(parse("?avail=in,ready,bogus")).toEqual({ avail: ["in", "ready"] });
    expect(parse("?avail=bogus")).toEqual({});
  });

  it("ignores unknown keys and malformed attr keys", () => {
    expect(parse("?foo=bar")).toEqual({});
    expect(parse("?attr.Bad Key=1")).toEqual({});
    expect(parse("?attr.=1")).toEqual({});
    expect(parse("?attr.wattage=1500,2000")).toEqual({ attr: { wattage: ["1500", "2000"] } });
  });

  it("trims, strips control characters, drops empties and over-long values", () => {
    expect(parse("?brand=%20smeg%20")).toEqual({ brand: ["smeg"] });
    expect(parse("?brand=sm%01eg")).toEqual({ brand: ["smeg"] });
    expect(parse("?brand=,,")).toEqual({});
    expect(parse(`?brand=${"x".repeat(PLP_MAX_VALUE_LEN + 1)}`)).toEqual({});
  });

  it("caps a facet at PLP_MAX_VALUES_PER_FACET", () => {
    const many = Array.from({ length: PLP_MAX_VALUES_PER_FACET + 5 }, (_, i) => `b${String(i).padStart(2, "0")}`);
    expect(parse(`?brand=${many.join(",")}`).brand).toHaveLength(PLP_MAX_VALUES_PER_FACET);
  });

  it("never throws", () => {
    for (const q of ["?", "?=", "?brand", "?price=%%%", "?attr.a=%zz", "?page=-1", "?avail=", "?density=۵"]) {
      expect(() => parse(q)).not.toThrow();
    }
    expect(parse("?density=۵")).toEqual({ density: 5 });
  });
});

describe("roundtrip property (50 random states)", () => {
  /** deterministic PRNG - the spec forbids Math.random, and a test must not depend on chance. */
  const mulberry32 = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const BRANDS = ["smeg", "dyson", "ninja", "tefal", "berghoff"];
  const COLORS = ["مشکی", "سفید", "قرمز", "cream", "black"];
  const COLLECTIONS = ["gifts", "ready", "new-season"];
  const ATTR_KEYS = ["wattage", "color_family", "capacity_l"];

  it("parsePlpState(plpUrl(base, s)) deep-equals normalizePlpState(s) for 50 generated states", () => {
    const rnd = mulberry32(20260825);
    const pick = <T,>(xs: readonly T[], n: number): T[] => xs.filter(() => rnd() < n);
    for (let i = 0; i < 50; i += 1) {
      const state: PlpState = {};
      if (rnd() < 0.6) state.brand = pick(BRANDS, 0.5);
      if (rnd() < 0.5) state.color = pick(COLORS, 0.5);
      if (rnd() < 0.4) state.collection = pick(COLLECTIONS, 0.5);
      if (rnd() < 0.4) state.avail = pick(AVAIL_FILTERS, 0.5);
      if (rnd() < 0.4) {
        const min = Math.floor(rnd() * 5_000_000);
        state.priceMin = min;
        if (rnd() < 0.7) state.priceMax = min + Math.floor(rnd() * 5_000_000);
      }
      if (rnd() < 0.4) {
        const attr: Record<string, string[]> = {};
        for (const key of pick(ATTR_KEYS, 0.6)) attr[key] = pick(["a", "b", "c"], 0.7);
        state.attr = attr;
      }
      if (rnd() < 0.6) state.sort = SORT_KEYS[Math.floor(rnd() * SORT_KEYS.length)] ?? "recommended";
      if (rnd() < 0.6) state.page = 1 + Math.floor(rnd() * 30);
      if (rnd() < 0.4) state.density = rnd() < 0.5 ? 3 : 5;

      const normalized = normalizePlpState(state);
      expect(roundTrip("/shop/", state)).toEqual(normalized);
      // and the serialization itself is idempotent
      expect(plpUrl("/shop/", normalized)).toBe(plpUrl("/shop/", state));
    }
  });

  it("normalizePlpState never mutates its input", () => {
    const state: PlpState = { brand: ["smeg", "dyson"], attr: { wattage: ["2", "1"] }, page: 4 };
    const snapshot = structuredClone(state);
    normalizePlpState(state);
    plpUrl("/shop/", state);
    withoutFilter(state, "brand", "smeg");
    expect(state).toEqual(snapshot);
  });
});

describe("canonicalPlpUrl", () => {
  it("drops every filter and sort, keeping only ?page=N", () => {
    expect(canonicalPlpUrl("/shop/", { brand: ["smeg"], page: 3 })).toBe("/shop/?page=3");
    expect(canonicalPlpUrl("/shop/", { brand: ["smeg"], page: 1 })).toBe("/shop/");
    expect(canonicalPlpUrl("/shop/", { brand: ["smeg"], sort: "newest", density: 5 })).toBe("/shop/");
    expect(canonicalPlpUrl("/shop/", {})).toBe("/shop/");
    expect(canonicalPlpUrl("/shop", { page: 2 })).toBe("/shop/?page=2");
    expect(canonicalPlpUrl("/shop/", { page: PLP_MAX_PAGE + 1 })).toBe("/shop/");
  });
});

describe("isIndexablePlpState", () => {
  it("is true only without filters and with the default sort", () => {
    expect(isIndexablePlpState({})).toBe(true);
    expect(isIndexablePlpState({ page: 2 })).toBe(true);
    expect(isIndexablePlpState({ density: 5 })).toBe(true);
    expect(isIndexablePlpState({ sort: "recommended" })).toBe(true);
    expect(isIndexablePlpState({ brand: ["smeg"] })).toBe(false);
    expect(isIndexablePlpState({ sort: "newest" })).toBe(false);
    expect(isIndexablePlpState({ priceMin: 1 })).toBe(false);
    expect(isIndexablePlpState({ attr: { wattage: ["1500"] } })).toBe(false);
  });
});

describe("isDefaultPlpState", () => {
  it("ignores density but not page", () => {
    expect(isDefaultPlpState({})).toBe(true);
    expect(isDefaultPlpState({ density: 5 })).toBe(true);
    expect(isDefaultPlpState({ sort: "recommended", page: 1 })).toBe(true);
    expect(isDefaultPlpState({ page: 2 })).toBe(false);
    expect(isDefaultPlpState({ brand: ["smeg"] })).toBe(false);
  });
});

describe("activeFilterCount", () => {
  it("counts every facet value once and the price pair once", () => {
    expect(activeFilterCount({ brand: ["a", "b"], priceMin: 1, avail: ["in"] })).toBe(4);
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ sort: "newest", page: 4, density: 5 })).toBe(0);
    expect(activeFilterCount({ priceMin: 1, priceMax: 2 })).toBe(1);
    expect(activeFilterCount({ attr: { wattage: ["1500", "2000"], color_family: ["red"] } })).toBe(3);
    expect(activeFilterCount({ brand: ["a", "a"] })).toBe(1);
  });
});

describe("withoutFilter", () => {
  it("removes one value of a facet and resets the page", () => {
    expect(withoutFilter({ brand: ["a", "b"], page: 3 }, "brand", "a")).toEqual({ brand: ["b"] });
  });

  it("removes the whole facet when the last value goes or no value is given", () => {
    expect(withoutFilter({ brand: ["a"] }, "brand", "a")).toEqual({});
    expect(withoutFilter({ brand: ["a", "b"] }, "brand")).toEqual({});
    expect(withoutFilter({ avail: ["in", "sale"] }, "avail", "in")).toEqual({ avail: ["sale"] });
  });

  it("removes price as a pair from either end", () => {
    expect(withoutFilter({ priceMin: 1, priceMax: 2 }, "priceMin")).toEqual({});
    expect(withoutFilter({ priceMin: 1, priceMax: 2 }, "priceMax")).toEqual({});
  });

  it("removes an attr chip by \"key:value\" and a whole attr group by key", () => {
    const state: PlpState = { attr: { wattage: ["1500", "2000"], color_family: ["red"] } };
    expect(withoutFilter(state, "attr", "wattage:1500")).toEqual({
      attr: { color_family: ["red"], wattage: ["2000"] },
    });
    expect(withoutFilter(state, "attr", "color_family")).toEqual({ attr: { wattage: ["1500", "2000"] } });
    expect(withoutFilter(state, "attr")).toEqual({});
    expect(withoutFilter({ attr: { wattage: ["1500"] } }, "attr", "wattage:1500")).toEqual({});
  });

  it("removes sort, density and page", () => {
    expect(withoutFilter({ sort: "newest", page: 2 }, "sort")).toEqual({});
    expect(withoutFilter({ density: 5, page: 2 }, "density")).toEqual({});
    expect(withoutFilter({ brand: ["a"], page: 2 }, "page")).toEqual({ brand: ["a"] });
  });

  it("leaves an unknown value untouched", () => {
    expect(withoutFilter({ brand: ["a", "b"] }, "brand", "zz")).toEqual({ brand: ["a", "b"] });
  });
});
