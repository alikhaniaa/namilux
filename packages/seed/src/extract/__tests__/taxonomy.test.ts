import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  COLOR_ATTRIBUTE,
  COLOR_TOKENS_EN,
  COLOR_TOKENS_FA,
  type LegacyColorTerm,
  canonicalColorName,
  colorFromName,
  readColorTerms,
} from "../taxonomy.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "taxonomiesStoreJson"));
const ZWNJ = "‌";

describe("the seeded attribute", () => {
  it("colour is the only filterable attribute row, with no hex derived", () => {
    expect(COLOR_ATTRIBUTE).toEqual({
      key: "color",
      label: "رنگ",
      unit: null,
      kind: "color",
      isFilterable: true,
      isComparable: true,
      sort: 0,
    });
    expect(COLOR_TOKENS_FA.length).toBeGreaterThan(20);
    expect(COLOR_TOKENS_EN).toContain("rosegold");
  });
});

describe("canonicalColorName (pure)", () => {
  it("canonical name applies ZWNJ", () => {
    expect(canonicalColorName("سورمه ای")).toBe(`سورمه${ZWNJ}ای`);
    expect(canonicalColorName("نقره ای")).toBe(`نقره${ZWNJ}ای`);
    // Idempotent.
    expect(canonicalColorName(canonicalColorName("سورمه ای"))).toBe(`سورمه${ZWNJ}ای`);
  });

  it("رزگلد and رز گلد collapse to one canonical spelling", () => {
    expect(canonicalColorName("رز گلد")).toBe("رزگلد");
    expect(canonicalColorName("رزگلد")).toBe("رزگلد");
  });

  it("compound colour kept intact and Arabic letters fixed", () => {
    expect(canonicalColorName("سفید-طلایی")).toBe("سفید-طلایی");
    expect(canonicalColorName(" ابي  كاربني ")).toBe("ابی کاربنی");
    expect(canonicalColorName("")).toBe("");
  });
});

describe("colorFromName (pure)", () => {
  it("longest token wins", () => {
    expect(colorFromName("قابلمه سبز سرامیکی اسمگ")).toBe("سبز سرامیکی");
    expect(colorFromName("قابلمه سبز اسمگ")).toBe("سبز");
    expect(colorFromName("ماگ طوسی صورتی")).toBe("طوسی صورتی");
  });

  it("رنگ is not a colour", () => {
    expect(colorFromName("رنگ")).toBeNull();
    expect(colorFromName("کتری برقی ساده اسمگ KLF03 رنگ کرم")).toBe("کرم");
  });

  it("both spellings of ابی/آبی کاربنی resolve", () => {
    expect(colorFromName("سشوار آبی کاربنی")).toBe("آبی کاربنی");
    expect(colorFromName("سشوار ابی کاربنی")).toBe("ابی کاربنی");
  });

  it("returns null when no colour token is present", () => {
    expect(colorFromName("جارو رباتیک Roborock S8")).toBeNull();
    expect(colorFromName("")).toBeNull();
  });
});

describe.skipIf(!hasExtract)("real pa_color terms", () => {
  let terms: LegacyColorTerm[];

  beforeAll(async () => {
    terms = await readColorTerms(dir);
  });

  it("21 terms read in order", () => {
    expect(terms).toHaveLength(21);
    expect(terms[0]).toMatchObject({ id: 28, nameFa: "آبی", slug: "blue" });
    expect(terms[1]).toMatchObject({ id: 67, nameFa: "ابی کاربنی" });
    expect(new Set(terms.map((t) => t.id)).size).toBe(21);
  });

  it("slugs are decoded and counts are numbers", () => {
    for (const t of terms) {
      expect(/%[0-9a-f]{2}/i.test(t.slug)).toBe(false);
      expect(Number.isInteger(t.count)).toBe(true);
      expect(t.nameFa.length).toBeGreaterThan(0);
    }
  });

  it("دولچی گابانا stays a valid attribute value", () => {
    const dg = terms.find((t) => t.nameFa.includes("دولچی"));
    expect(dg).toBeDefined();
    expect(canonicalColorName(dg?.nameFa ?? "")).toBe(dg?.nameFa);
    expect(colorFromName(`ماگ ${dg?.nameFa}`)).toBe("دولچی گابانا");
  });

  it("every term name survives canonicalisation without losing characters", () => {
    for (const t of terms) expect(canonicalColorName(t.nameFa).length).toBeGreaterThanOrEqual(t.nameFa.length - 1);
  });
});
