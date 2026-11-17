import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  BRAND_ALIASES,
  type BrandSeed,
  LEGACY_BRAND_META,
  NEW_BRANDS,
  readLegacyBrands,
  resolveBrandSlug,
} from "../brands.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "taxonomiesStoreJson"));

const base = { paBrandSlug: null, customBrand: null, commerceBrand: null, curatedBrandEn: null, name: "" };

describe("resolveBrandSlug (pure)", () => {
  it("precedence order: pa_brand wins over custom, commerce, curated and name", () => {
    expect(resolveBrandSlug({ ...base, paBrandSlug: "dyson", customBrand: "اسمگ", commerceBrand: "smeg", curatedBrandEn: "SMEG", name: "tefal" })).toEqual({
      slug: "dyson",
      source: "pa_brand",
    });
    expect(resolveBrandSlug({ ...base, customBrand: "اسمگ", commerceBrand: "figaro", curatedBrandEn: "Ninja", name: "tefal" })).toEqual({
      slug: "smeg",
      source: "custom",
    });
    expect(resolveBrandSlug({ ...base, commerceBrand: "figaro", curatedBrandEn: "Ninja", name: "tefal" })).toEqual({
      slug: "figaro",
      source: "commerce_brands",
    });
    expect(resolveBrandSlug({ ...base, curatedBrandEn: "Ninja", name: "tefal" })).toEqual({ slug: "ninja", source: "curated" });
  });

  it("Sage / Breville maps to sage", () => {
    expect(resolveBrandSlug({ ...base, curatedBrandEn: "Sage / Breville" })).toEqual({ slug: "sage", source: "curated" });
    expect(resolveBrandSlug({ ...base, curatedBrandEn: "Berghoff" })).toEqual({ slug: "berghoff", source: "curated" });
  });

  it("Unidentified never resolves", () => {
    expect(resolveBrandSlug({ ...base, curatedBrandEn: "Unidentified" })).toEqual({ slug: null, source: null });
    expect(resolveBrandSlug({ ...base, customBrand: "نامشخص" })).toEqual({ slug: null, source: null });
    // …but the name may still rescue it.
    expect(resolveBrandSlug({ ...base, curatedBrandEn: "Unidentified", name: "کتری برقی اسمگ KLF03" })).toEqual({
      slug: "smeg",
      source: "name",
    });
  });

  it("name-token fallback: first alias in name order wins", () => {
    expect(resolveBrandSlug({ ...base, name: "tefal masterchop xxl خردکن" })).toEqual({ slug: "tefal", source: "name" });
    expect(resolveBrandSlug({ ...base, name: "پک لوازم جانبی اسمگ و دایسون" })).toEqual({ slug: "smeg", source: "name" });
    expect(resolveBrandSlug({ ...base, name: "پک لوازم جانبی دایسون و اسمگ" })).toEqual({ slug: "dyson", source: "name" });
    // Multi-word alias.
    expect(resolveBrandSlug({ ...base, name: "بشقاب بم بوم چوبی" })).toEqual({ slug: "bambum", source: "name" });
    expect(resolveBrandSlug({ ...base, name: "جارو رباتیک Roborock S8" })).toEqual({ slug: null, source: null });
  });

  it("a percent-encoded term slug is decoded before comparison", () => {
    expect(resolveBrandSlug({ ...base, paBrandSlug: "%64%79%73%6f%6e" })).toEqual({ slug: "dyson", source: "pa_brand" });
  });

  it("every alias points at a known brand slug", () => {
    const known = new Set([...Object.keys(LEGACY_BRAND_META), ...NEW_BRANDS.map((b) => b.slug)]);
    for (const slug of Object.values(BRAND_ALIASES)) expect(known.has(slug)).toBe(true);
  });
});

describe.skipIf(!hasExtract)("real taxonomies_store.json", () => {
  let brands: BrandSeed[];

  beforeAll(async () => {
    brands = await readLegacyBrands(dir);
  });

  it("13 brands with legacy ids intact", () => {
    expect(brands).toHaveLength(13);
    const byId = new Map(brands.filter((b) => b.legacy).map((b) => [b.slug, b.legacyId]));
    expect(Object.fromEntries(byId)).toEqual({
      smeg: 24,
      dyson: 52,
      breville: 159,
      sage: 182,
      como: 190,
      figaro: 196,
      bambum: 197,
    });
    expect(brands.filter((b) => b.legacy)).toHaveLength(7);
    expect(brands.filter((b) => !b.legacy)).toHaveLength(6);
    expect(brands.filter((b) => !b.legacy).every((b) => b.legacyId === null)).toBe(true);
  });

  it("all 13 are active at seed and claims are never invented for the new brands", () => {
    expect(brands.every((b) => b.isActive)).toBe(true);
    expect(brands.filter((b) => b.legacy).every((b) => b.claim.length > 0)).toBe(true);
    expect(brands.filter((b) => !b.legacy).every((b) => b.claim === "")).toBe(true);
  });

  it("legacy sort follows term order, new brands start at 100", () => {
    const legacy = brands.filter((b) => b.legacy);
    expect(legacy.map((b) => b.sort)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(brands.filter((b) => !b.legacy).map((b) => b.sort)).toEqual([100, 101, 102, 103, 104, 105]);
    expect(new Set(brands.map((b) => b.slug)).size).toBe(13);
  });

  it("carries both names for every brand", () => {
    for (const b of brands) {
      expect(b.nameFa.length).toBeGreaterThan(0);
      expect(b.nameEn.length).toBeGreaterThan(0);
    }
    expect(brands.find((b) => b.slug === "smeg")?.nameEn).toBe("SMEG");
    expect(brands.find((b) => b.slug === "berghoff")?.nameEn).toBe("BergHOFF");
  });
});
