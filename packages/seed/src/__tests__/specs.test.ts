import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { dimsFromSpecs, specsFromAttributes, splitFusedValue, MAX_ITEMS_PER_VALUE } from "../transform/specs.js";

const PRODUCTS_DIR = fileURLToPath(new URL("../../../../data/extract/04_catalog/products", import.meta.url));
const hasCorpus = existsSync(PRODUCTS_DIR);

describe("newline + header grouping", () => {
  const raw = "صافی جدا شونده قابل شست و شو\nپایه ضدلغزش\nدارای نشانگر دمای کار\n\nاقلام همراه:\n\nیک عدد دفترچه راهنمای تصویری";

  it("splits on newlines and keeps the header item", () => {
    expect(splitFusedValue(raw)).toHaveLength(5);
  });

  it("produces 4 rows, the last one grouped under «اقلام همراه»", () => {
    const { rows, fusedSplit } = specsFromAttributes([{ label: "ویژگی ها", rawValue: raw }]);
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).every((r) => r.groupName === null)).toBe(true);
    expect(rows[3]?.groupName).toBe("اقلام همراه");
    expect(rows[3]?.value).toBe("یک عدد دفترچه راهنمای تصویری");
    expect(rows.map((r) => r.sort)).toEqual([0, 1, 2, 3]);
    expect(fusedSplit).toBe(1);
  });

  it("keeps the attribute label on every row (stable compare column)", () => {
    const { rows } = specsFromAttributes([{ label: "سایر مشخصات", rawValue: raw }]);
    expect(new Set(rows.map((r) => r.label))).toEqual(new Set(["سایر مشخصات"]));
  });
});

describe("comma split", () => {
  it("splits the «سایر مشخصات» catch-all into one row per item", () => {
    const raw = "تنظیم باد سرد, سه دکمه برای تنظیم دقیق حرات نیز تعبیه شده است, سه سرعت جهت تنظبم باد مورد نظر, کنترل هوشمند حرارت";
    expect(splitFusedValue(raw)).toHaveLength(4);
    const { rows } = specsFromAttributes([{ label: "سایر مشخصات", rawValue: raw }]);
    expect(rows).toHaveLength(4);
    expect(rows[0]?.value).toBe("تنظیم باد سرد");
  });

  it("splits on «،» «؛» «;» and « | »", () => {
    expect(splitFusedValue("الف، ب؛ پ; ت | ث")).toEqual(["الف", "ب", "پ", "ت", "ث"]);
  });

  it("«شامل :» mid-item is not a group header", () => {
    const raw = "لوازم جانبی شامل : تامپر، لیوان جنس تریتان 700 میلی لیتری شخصی";
    const { rows } = specsFromAttributes([{ label: "اقلام همراه", rawValue: raw }]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.groupName === null)).toBe(true);
    expect(rows[0]?.value).toBe("لوازم جانبی شامل : تامپر");
  });
});

describe("decimal comma preserved", () => {
  it("a comma between digits is not a separator", () => {
    // splitFusedValue is the raw splitter; the Persian pass runs in specsFromAttributes.
    expect(splitFusedValue("1,5 لیتر")).toEqual(["1,5 لیتر"]);
  });

  it("a comma inside parentheses is not a separator", () => {
    expect(splitFusedValue("ظرفیت (بزرگ, کوچک)")).toHaveLength(1);
  });

  it("the value keeps its Persian digits after cleaning", () => {
    const { rows } = specsFromAttributes([{ label: "ظرفیت", rawValue: "1,5 لیتر" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("۱,۵ لیتر");
  });
});

describe("trailing separator", () => {
  it("ignores a dangling «،»", () => {
    const raw =
      "طراحی منحصر به فرد درب برای کارهای با سرعت بالا برای تخلیه بخار و جلوگیری از پاشش مواد، تعبیه حلقه برای جداشدن آسان درب، عملکرد تمیز کردن خودکاربا لمس یک دکمه، ";
    expect(splitFusedValue(raw)).toHaveLength(3);
  });

  it("empty / whitespace-only values produce no rows", () => {
    expect(splitFusedValue("   ")).toEqual([]);
    expect(specsFromAttributes([{ label: "جنس بدنه", rawValue: "  " }]).rows).toEqual([]);
  });
});

describe("non-spec labels skipped", () => {
  it("drops brand, colour, short description and model rows", () => {
    const { rows } = specsFromAttributes([
      { label: "برند", rawValue: "اسمگ" },
      { label: "رنگ", rawValue: "مشکی" },
      { label: "مدل دستگاه", rawValue: "KLF04" },
      { label: "توضیحات کوتاه محصول", rawValue: "متن" },
      { label: "جنس بدنه", rawValue: "نیکل و مس" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("جنس بدنه");
  });

  it("matches the skip list after normalisation (Arabic kaf / spacing)", () => {
    expect(specsFromAttributes([{ label: " برند ", rawValue: "اسمگ" }]).rows).toEqual([]);
  });
});

describe("cap 40", () => {
  it("caps a value at MAX_ITEMS_PER_VALUE items", () => {
    const raw = Array.from({ length: 45 }, (_, n) => `مورد شمارهٔ ${n}`).join("، ");
    expect(MAX_ITEMS_PER_VALUE).toBe(40);
    expect(splitFusedValue(raw)).toHaveLength(40);
    expect(specsFromAttributes([{ label: "سایر مشخصات", rawValue: raw }]).rows).toHaveLength(40);
  });
});

describe("dedupe by faNorm", () => {
  it("drops items that differ only by an Arabic yeh or spacing", () => {
    expect(splitFusedValue("صافي جدا شونده، صافی جدا شونده، پایه ضدلغزش")).toHaveLength(2);
  });
});

describe("dims parsing table", () => {
  const row = (label: string, value: string, sort = 0) => ({ groupName: null, label, value, sort });

  it("parses the legacy dimension labels", () => {
    const dims = dimsFromSpecs([
      row("طول", "28 سانتی متر"),
      row("عرض", "4 سانتی متر", 1),
      row("ارتفاع", "4.5 سانتی متر", 2),
      row("وزن", "1.2 کیلوگرم", 3),
    ]);
    expect(dims).toEqual({ lengthMm: 280, widthMm: 40, heightMm: 45, weightG: 1200 });
  });

  it("parses grams, millimetres and Persian digits", () => {
    expect(dimsFromSpecs([row("وزن", "800 گرم")]).weightG).toBe(800);
    expect(dimsFromSpecs([row("طول", "۳۰۰ میلی متر")]).lengthMm).toBe(300);
  });

  it("parses a fused «ابعاد» row into l/w/h", () => {
    expect(dimsFromSpecs([row("ابعاد", "ابعاد 30×20×15 سانتی متر")])).toEqual({
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      weightG: null,
    });
  });

  it("explicit labels win over the fused «ابعاد» row", () => {
    const dims = dimsFromSpecs([row("ابعاد", "30×20×15 سانتی متر"), row("ارتفاع", "20 سانتی متر", 1)]);
    expect(dims.heightMm).toBe(200);
    expect(dims.lengthMm).toBe(300);
  });

  it("never invents a size when the unit is missing or unknown (DECISION)", () => {
    expect(dimsFromSpecs([row("طول", "28")])).toEqual({ lengthMm: null, widthMm: null, heightMm: null, weightG: null });
    expect(dimsFromSpecs([row("وزن", "سبک")]).weightG).toBeNull();
    expect(dimsFromSpecs([])).toEqual({ lengthMm: null, widthMm: null, heightMm: null, weightG: null });
  });
});

describe.skipIf(!hasCorpus)("real catalogue", () => {
  type LegacyTerm = { name?: string };
  type LegacyAttribute = { name?: string; taxonomy?: string | null; terms?: LegacyTerm[] };
  type LegacyProduct = { id: number; attributes?: LegacyAttribute[] };

  const products: LegacyProduct[] = readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(`${PRODUCTS_DIR}/${d.name}/product.json`, "utf8")) as LegacyProduct);

  /** v1 ingest.mjs §3 joined the custom-attribute terms with "، "; the seed reverses that join. */
  const attrsOf = (p: LegacyProduct) =>
    (p.attributes ?? [])
      .filter((a) => !a.taxonomy)
      .map((a) => ({ label: a.name ?? "", rawValue: (a.terms ?? []).map((t) => t.name ?? "").join("، ") }))
      .filter((a) => a.label !== "" && a.rawValue !== "");

  it("yields real one-value rows for the whole catalogue", () => {
    expect(products).toHaveLength(541);
    let rows = 0;
    let fused = 0;
    let withSpecs = 0;
    for (const p of products) {
      const out = specsFromAttributes(attrsOf(p));
      rows += out.rows.length;
      fused += out.fusedSplit;
      if (out.rows.length > 0) withSpecs += 1;
      for (const r of out.rows) {
        expect(r.value.length).toBeGreaterThan(0);
        expect(r.value).not.toMatch(/<[a-z]/i);
        expect(r.label).not.toMatch(/[:：]$/);
      }
    }
    // Measured on the frozen extract (2026-08): 675 custom attributes on 63 of the 541 products
    // become 791 one-value rows, 58 of those attribute values were fused lists.
    expect(rows).toBe(791);
    expect(fused).toBe(58);
    expect(withSpecs).toBe(63);
  });

  it("splits the comma-fused lists of the catalogue", () => {
    const commaProducts = products.filter((p) => attrsOf(p).some((a) => /[،,]/.test(a.rawValue)));
    const splitProducts = commaProducts.filter((p) => specsFromAttributes(attrsOf(p)).fusedSplit > 0);
    // 20 products carry a comma in a custom attribute; 19 of them are real lists (the remaining
    // one is a single item whose comma is trailing).
    expect(commaProducts).toHaveLength(20);
    expect(splitProducts).toHaveLength(19);
    // No decimal comma survives as a separator: the catalogue has none, so none may be invented.
    for (const p of products) {
      for (const a of attrsOf(p)) {
        if (!/\d\s*,\s*\d/.test(a.rawValue)) continue;
        expect(splitFusedValue(a.rawValue).join("|")).toContain(",");
      }
    }
  });
});
