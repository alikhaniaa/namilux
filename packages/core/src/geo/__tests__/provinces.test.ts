import { describe, expect, it } from "vitest";
import {
  ETA_DAYS,
  ETA_ZONES,
  PROVINCES,
  PROVINCE_CODES,
  canonicalCity,
  cityExists,
  etaDays,
  etaZone,
  findProvinceByName,
  getProvince,
  isProvinceCode,
  listCities,
  listProvinces,
  type EtaZone,
  type ProvinceCode,
} from "../provinces";

describe("dataset shape and counts", () => {
  it("has the 31 provinces of the extract", () => {
    expect(PROVINCES.length).toBe(31);
    expect(PROVINCE_CODES.length).toBe(31);
  });

  it("has 2,704 cities (2,705 extract rows minus the duplicate folded away)", () => {
    expect(PROVINCES.reduce((sum, p) => sum + p.cities.length, 0)).toBe(2704);
  });

  it("every code of PROVINCE_CODES appears exactly once in the JSON", () => {
    const codes = PROVINCES.map((p) => p.code);
    expect(new Set(codes).size).toBe(31);
    for (const code of PROVINCE_CODES) {
      expect(codes.filter((c) => c === code).length).toBe(1);
    }
  });

  it("carries no Arabic ي/ك, no duplicate city and no untrimmed name", () => {
    for (const p of PROVINCES) {
      expect(p.name).toBe(p.name.trim());
      expect(p.name).not.toMatch(/[يكى]/);
      expect(new Set(p.cities).size).toBe(p.cities.length);
      for (const city of p.cities) {
        expect(city).toBe(city.trim());
        expect(city).not.toMatch(/[يكى]/);
        expect(city).not.toMatch(/\s{2,}/);
      }
    }
  });

  it("listProvinces returns 31 entries without the city arrays", () => {
    const list = listProvinces();
    expect(list.length).toBe(31);
    expect(Object.keys(list[0] ?? {})).toEqual(["code", "name"]);
    expect(list.map((p) => p.code)).toEqual(PROVINCES.map((p) => p.code));
  });

  it("keeps the JSON order (Persian collation, not re-sorted at runtime)", () => {
    expect(PROVINCES[0]?.name).toBe("آذربایجان شرقی");
    expect(PROVINCES[PROVINCES.length - 1]?.name).toBe("یزد");
  });
});

describe("getProvince / findProvinceByName", () => {
  it("matches a code exactly and case-sensitively", () => {
    expect(getProvince("THR")?.name).toBe("تهران");
    expect(getProvince("thr")).toBeNull();
    expect(getProvince("XXX")).toBeNull();
    expect(getProvince("")).toBeNull();
    expect(getProvince(null as unknown as string)).toBeNull();
  });

  it("finds a province by its Persian name", () => {
    expect(findProvinceByName("تهران")?.code).toBe("THR");
    expect(findProvinceByName("  تهران  ")?.code).toBe("THR");
  });

  it("tolerates Arabic ي in the name", () => {
    expect(findProvinceByName("خراسان رضوي")?.code).toBe("RKH");
  });

  it("also accepts the code", () => {
    expect(findProvinceByName("THR")?.code).toBe("THR");
  });

  it("returns null for an unknown name", () => {
    expect(findProvinceByName("ناکجا")).toBeNull();
    expect(findProvinceByName("")).toBeNull();
    expect(findProvinceByName(null as unknown as string)).toBeNull();
  });

  it("round-trips every province name", () => {
    for (const p of PROVINCES) {
      expect(findProvinceByName(p.name)?.code).toBe(p.code);
    }
  });
});

describe("city lookups tolerate Arabic letters and spaces", () => {
  it("lists the expected city counts", () => {
    expect(listCities("THR")).toContain("تهران");
    expect(listCities("THR").length).toBe(132);
    expect(listCities("ABZ").length).toBe(13);
    expect(listCities("XXX" as ProvinceCode)).toEqual([]);
  });

  it("cityExists is tolerant of trailing spaces and strict about the province", () => {
    expect(cityExists("THR", "تهران")).toBe(true);
    expect(cityExists("THR", "تهران ")).toBe(true);
    expect(cityExists("THR", " تهران")).toBe(true);
    expect(cityExists("THR", "تبریز")).toBe(false);
    expect(cityExists("THR", "")).toBe(false);
    expect(cityExists("XXX" as ProvinceCode, "تهران")).toBe(false);
  });

  it("canonicalCity returns the stored spelling for an Arabic-letter input", () => {
    expect(canonicalCity("EAZ", "تبريز")).toBe("تبریز");
    expect(canonicalCity("THR", "تهران")).toBe("تهران");
    expect(canonicalCity("THR", "ناکجا")).toBeNull();
    expect(canonicalCity("THR", null as unknown as string)).toBeNull();
  });

  it("canonicalCity round-trips every stored city of every province", () => {
    for (const p of PROVINCES) {
      for (const city of p.cities) {
        expect(canonicalCity(p.code, city)).toBe(city);
      }
    }
  });
});

describe("eta zones partition the codes", () => {
  it("covers all 31 codes exactly once", () => {
    const all = [...ETA_ZONES.tehran, ...ETA_ZONES.neighbours, ...ETA_ZONES.far];
    expect(all.length).toBe(31);
    expect(new Set(all).size).toBe(31);
    expect([...all].sort()).toEqual([...PROVINCE_CODES].sort());
  });

  it("assigns the documented zones", () => {
    expect(etaZone("THR")).toBe("tehran");
    expect(etaZone("ABZ")).toBe("neighbours");
    expect(etaZone("GZN")).toBe("neighbours");
    expect(etaZone("SBN")).toBe("far");
  });

  it("falls back to the slowest zone for an unknown code", () => {
    expect(etaZone("XXX" as ProvinceCode)).toBe("far");
  });

  it("every province code resolves to a zone", () => {
    for (const code of PROVINCE_CODES) {
      const zone: EtaZone = etaZone(code);
      expect(ETA_ZONES[zone]).toContain(code);
    }
  });
});

describe("etaDays table", () => {
  const rows: [ProvinceCode, { min: number; max: number }][] = [
    ["THR", { min: 1, max: 3 }],
    ["ABZ", { min: 2, max: 4 }],
    ["MZN", { min: 2, max: 4 }],
    ["SMN", { min: 2, max: 4 }],
    ["QHM", { min: 2, max: 4 }],
    ["MKZ", { min: 2, max: 4 }],
    ["GZN", { min: 2, max: 4 }],
    ["SBN", { min: 4, max: 7 }],
    ["FRS", { min: 4, max: 7 }],
    ["EAZ", { min: 4, max: 7 }],
  ];

  for (const [code, want] of rows) {
    it(`etaDays(${code}) → ${want.min}–${want.max}`, () => {
      expect(etaDays(code)).toEqual(want);
    });
  }

  it("matches ETA_DAYS", () => {
    expect(ETA_DAYS).toEqual({ tehran: { min: 1, max: 3 }, neighbours: { min: 2, max: 4 }, far: { min: 4, max: 7 } });
  });
});

describe("isProvinceCode", () => {
  it("accepts every real code and rejects junk", () => {
    for (const code of PROVINCE_CODES) expect(isProvinceCode(code)).toBe(true);
    expect(isProvinceCode("GZN")).toBe(true);
    expect(isProvinceCode("")).toBe(false);
    expect(isProvinceCode("gzn")).toBe(false);
    expect(isProvinceCode("XXX")).toBe(false);
    expect(isProvinceCode(null as unknown as string)).toBe(false);
  });
});
