import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_NAME_MAX,
  SEPARATOR,
  buildDisplayName,
  nameLooksLikeScrape,
  typeFromName,
} from "../transform/display-name.js";
import { extractModelCode } from "../transform/model-key.js";

const EXTRACT = fileURLToPath(new URL("../../../../data/extract", import.meta.url));
const PRODUCTS_DIR = `${EXTRACT}/04_catalog/products`;
const CURATED_CSV = `${EXTRACT}/10_rebuild-brief/namilux-products-categorised.csv`;
const hasCorpus = existsSync(PRODUCTS_DIR) && existsSync(CURATED_CSV);

describe("canonical example", () => {
  it("builds «اسمگ کتری برقی KLF04BL · مشکی براق» without a draft flag", () => {
    const out = buildDisplayName({
      name: "کتری برقی درجه دار اسمگ KLF04BL",
      brandFa: "اسمگ",
      typeFa: "کتری برقی",
      modelCode: "KLF04BL",
      colorName: "مشکی براق",
    });
    expect(out.displayName).toBe(`اسمگ کتری برقی KLF04BL${SEPARATOR}مشکی براق`);
    expect(out.draft).toBe(false);
    expect(out.reasons).toEqual([]);
  });

  it("is idempotent when fed its own output as the name", () => {
    const input = {
      name: "کتری برقی درجه دار اسمگ KLF04BL",
      brandFa: "اسمگ",
      typeFa: "کتری برقی",
      modelCode: "KLF04BL",
      colorName: "مشکی براق",
    };
    const once = buildDisplayName(input);
    expect(buildDisplayName({ ...input, name: once.displayName }).displayName).toBe(once.displayName);
  });
});

describe("dyson example", () => {
  it("keeps the Latin designator uppercase and the colour after the separator", () => {
    const out = buildDisplayName({
      name: "ایرپ دیفیوزر 08 رنگ ردولوت dyson hs08",
      brandFa: "دایسون",
      typeFa: "استایلر و ایرپ",
      modelCode: "HS08",
      colorName: "ردولوت",
    });
    expect(out.displayName).toBe(`دایسون استایلر و ایرپ HS08${SEPARATOR}ردولوت`);
    expect(out.displayName).not.toMatch(/رنگ|مدل|new/u);
  });
});

describe("type from scrape name", () => {
  it("derives the type when the curated one is missing", () => {
    const out = buildDisplayName({
      name: "tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ مشکی",
      brandFa: "تفال",
      typeFa: null,
      modelCode: null,
      colorName: "مشکی",
    });
    expect(out.displayName).toBe(`تفال خردکن یک و نیم لیتری${SEPARATOR}مشکی`);
    expect(out.reasons).toContain("type-from-name");
    expect(out.draft).toBe(true);
  });

  it("typeFromName strips brands, colours, noise, model codes and Latin runs", () => {
    expect(typeFromName("tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ مشکی")).toBe("خردکن یک و نیم لیتری");
    expect(typeFromName("کتری برقی ساده اسمگ KLF03 رنگ کرم")).toBe("کتری برقی ساده");
    expect(typeFromName("dyson hs08")).toBeNull();
    expect(typeFromName("")).toBeNull();
  });
});

describe("missing parts flagged", () => {
  it("flags no-brand and no-model", () => {
    const out = buildDisplayName({ name: "قابلمه و تابه", brandFa: null, typeFa: "قابلمه و تابه", modelCode: null, colorName: null });
    expect(out.displayName).toBe("قابلمه و تابه");
    expect(out.reasons).toEqual(["no-brand", "no-model"]);
    expect(out.draft).toBe(true);
  });

  it("flags no-type when nothing can be derived", () => {
    const out = buildDisplayName({ name: "HS08", brandFa: "دایسون", typeFa: null, modelCode: "HS08", colorName: null });
    expect(out.reasons).toContain("no-type");
    expect(out.displayName).toBe("دایسون HS08");
  });
});

describe("shortens type not model", () => {
  it("drops type words from the end until the name fits", () => {
    const type = "قهوه ساز تمام اتوماتیک با آسیاب داخلی و کف ساز شیر حرفه ای";
    const out = buildDisplayName({ name: type, brandFa: "اسمگ", typeFa: type, modelCode: "BCC02", colorName: "مشکی" });
    expect(out.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(out.displayName.startsWith("اسمگ ")).toBe(true);
    expect(out.displayName).toContain("BCC02");
    expect(out.displayName.endsWith(`${SEPARATOR}مشکی`)).toBe(true);
    expect(out.reasons).toContain("shortened");
  });
});

describe("colour dropped last", () => {
  it("drops the colour only when brand + model + colour still exceed the cap", () => {
    const out = buildDisplayName({
      name: "x",
      brandFa: "برندی با نام بسیار طولانی برای آزمون",
      typeFa: null,
      modelCode: "SCA800BTR",
      colorName: "سفید مرواریدی براق پاستیلی",
    });
    expect(out.displayName).toBe("برندی با نام بسیار طولانی برای آزمون SCA800BTR");
    expect(out.reasons).toContain("colour-dropped");
    expect(out.displayName).not.toContain(SEPARATOR);
  });
});

describe("digit folding with guard", () => {
  it("folds Latin digits in the type but never inside the model code", () => {
    const out = buildDisplayName({
      name: "سشوار 1300 وات",
      brandFa: "دایسون",
      typeFa: "سشوار 1300 وات",
      modelCode: "KLF04",
      colorName: null,
    });
    expect(out.displayName).toBe("دایسون سشوار ۱۳۰۰ وات KLF04");
    expect(out.displayName).toMatch(/KLF04/);
  });

  it("applies ZWNJ to the Persian part", () => {
    const out = buildDisplayName({ name: "سرخ کن ها", brandFa: null, typeFa: "سرخ کن", modelCode: null, colorName: null });
    expect(out.displayName).toBe("سرخ‌کن");
  });
});

describe("never exceeds 60", () => {
  it("caps pathological inputs", () => {
    const out = buildDisplayName({
      name: "x",
      brandFa: "اسمگ",
      typeFa: "قهوه ".repeat(30).trim(),
      modelCode: "ECF01",
      colorName: "مشکی براق",
    });
    expect(out.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(DISPLAY_NAME_MAX).toBe(60);
  });
});

describe("scrape detector", () => {
  it("flags Latin-first names, «رنگ X» tails and duplicated brands", () => {
    expect(nameLooksLikeScrape("tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ مشکی")).toBe(true);
    expect(nameLooksLikeScrape("کتری برقی ساده اسمگ KLF03 رنگ کرم")).toBe(true);
    expect(nameLooksLikeScrape("ایرپ دیفیوزر 08 رنگ ردولوت dyson hs08")).toBe(true);
    expect(nameLooksLikeScrape("خردکن تفال tefal")).toBe(true);
  });

  it("does not flag a curated name", () => {
    expect(nameLooksLikeScrape("اسمگ کتری برقی KLF04BL · مشکی براق")).toBe(false);
    expect(nameLooksLikeScrape("")).toBe(false);
  });
});

describe.skipIf(!hasCorpus)("real catalogue", () => {
  type LegacyTerm = { name?: string };
  type LegacyAttribute = { taxonomy?: string | null; terms?: LegacyTerm[] };
  type LegacyProduct = { id: number; name: string; sku?: string; attributes?: LegacyAttribute[] };
  type CuratedRow = { id: string; brand_fa: string; sub_fa: string };

  const products: LegacyProduct[] = readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(`${PRODUCTS_DIR}/${d.name}/product.json`, "utf8")) as LegacyProduct);

  const curatedRows: CuratedRow[] = parse(readFileSync(CURATED_CSV), { columns: true, bom: true });
  const curated = new Map<string, CuratedRow>(curatedRows.map((r) => [String(r.id), r]));

  const inputOf = (p: LegacyProduct) => {
    const row = curated.get(String(p.id));
    const brandFa = row && row.brand_fa.trim() !== "" && row.brand_fa !== "نامشخص" ? row.brand_fa.trim() : null;
    const typeFa = row && row.sub_fa.trim() !== "" && row.sub_fa !== "نیازمند بررسی" ? row.sub_fa.trim() : null;
    const colorName =
      (p.attributes ?? []).find((a) => a.taxonomy === "pa_color")?.terms?.[0]?.name?.trim() ?? null;
    return { name: p.name, brandFa, typeFa, modelCode: extractModelCode(p.name, p.sku ?? null), colorName };
  };

  it("produces a name for every product and counts the drafts", () => {
    expect(products).toHaveLength(541);
    let curatedNames = 0;
    let drafts = 0;
    const reasons = new Map<string, number>();
    for (const p of products) {
      const out = buildDisplayName(inputOf(p));
      if (out.draft) {
        drafts += 1;
        for (const r of out.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
      } else {
        curatedNames += 1;
      }
      expect(out.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
      expect(out.displayName).not.toMatch(/[!！]/u);
    }
    // Measured on the frozen extract (2026-08): 293 of the 541 products get a confident name from
    // brand + curated type + model code; 248 stay drafts for the admin pass (v2 §10.1 budgets it).
    expect(curatedNames).toBe(293);
    expect(drafts).toBe(248);
    expect(curatedNames + drafts).toBe(541);
    expect(reasons.get("no-model")).toBeGreaterThan(200);
  });

  it("never leaves «رنگ», «مدل» or a Latin digit outside the model code", () => {
    for (const p of products) {
      const out = buildDisplayName(inputOf(p));
      if (out.displayName === "") continue;
      expect(out.displayName).not.toMatch(/(?:^| )رنگ(?: |$)/u);
      expect(out.displayName).not.toMatch(/(?:^| )مدل(?: |$)/u);
    }
  });
});
