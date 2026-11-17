import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractModelCode, groupByModelKey, modelKey, stripColorTokens } from "../transform/model-key.js";

const PRODUCTS_DIR = fileURLToPath(new URL("../../../../data/extract/04_catalog/products", import.meta.url));
const hasCorpus = existsSync(PRODUCTS_DIR);

describe("code table", () => {
  const table: [string, string | null][] = [
    ["کتری برقی درجه دار اسمگ KLF04BL", "KLF04BL"],
    ["ایرپ دیفیوزر 08 رنگ ردولوت dyson hs08", "HS08"],
    ["سودا ساز سیج sca 800 btr", "SCA800BTR"],
    ["تصفیه هوا دایسون سفید-طلایی مدل PH04", "PH04"],
    ["اسپرسوساز اسمگ ECF03", "ECF03"],
    ["جاروبرقی مدل BC251", "BC251"],
    ["کتری برقی ساده اسمگ KLF03 رنگ کرم", "KLF03"],
    ["ماشین ظرفشویی بدون مدل", null],
    ["سرخ کن ۱۳۰۰ وات", null],
    // v2 §10.1 lists "V16s" as a designator; the contract uppercases it.
    ["استایلر دایسون V16s", "V16S"],
  ];

  it.each(table)("extractModelCode(%s)", (name, expected) => {
    expect(extractModelCode(name)).toBe(expected);
  });

  it("ignores a bare numeric token and a year", () => {
    expect(extractModelCode("ایرپ دیفیوزر 08 رنگ ردولوت")).toBeNull();
    expect(extractModelCode("مدل ۲۰۲۴ جدید")).toBeNull();
  });
});

describe("stoplist", () => {
  it("never returns a stoplisted token", () => {
    expect(extractModelCode("tefal masterchop xxl خردکن تفال")).toBeNull();
    expect(extractModelCode("جارو شارژی موتور پر قدرت V9")).toBeNull();
    expect(extractModelCode("زوم 2X با کیفیت 4K")).toBeNull();
  });
});

describe("sku precedence", () => {
  it("a full-match SKU wins over the name", () => {
    expect(extractModelCode("کتری برقی اسمگ KLF04", "KLF04BLEU")).toBe("KLF04BLEU");
  });

  it("a SKU that is not a designator falls back to the name", () => {
    expect(extractModelCode("کتری برقی اسمگ KLF04", "  ")).toBe("KLF04");
    expect(extractModelCode("کتری برقی اسمگ KLF04", "sku-تست-۱")).toBe("KLF04");
  });

  it("normalises separators and case", () => {
    expect(extractModelCode("x", "sca 800 btr")).toBe("SCA800BTR");
  });
});

describe("KLF03 groups eleven", () => {
  const colours = ["کرم", "مشکی", "سفید", "قرمز", "سبز", "آبی", "صورتی", "طوسی", "مسی", "زرد", "بنفش"];
  const names = colours.map((c) => `کتری برقی ساده اسمگ KLF03 رنگ ${c}`);

  it("all eleven colours share one key", () => {
    const keys = new Set(names.map((n) => modelKey(n)));
    expect(keys).toEqual(new Set(["smeg klf03"]));
  });

  it("groups the eleven into one model group", () => {
    const items = names.map((n, idx) => ({
      id: 100 + idx,
      key: modelKey(n),
      brandSlug: "smeg",
      buyable: idx === 3,
      hasImage: true,
      price: 41_500_000,
    }));
    const groups = groupByModelKey(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.ids).toHaveLength(11);
    expect(groups[0]?.primaryId).toBe(103);
    expect(groups[0]?.brandSlug).toBe("smeg");
  });

  it("duplicate names group as two members", () => {
    const key = modelKey("سودا ساز سیج sca 800 btr");
    const groups = groupByModelKey([
      { id: 1, key, brandSlug: "sage", buyable: false, hasImage: false, price: 0 },
      { id: 2, key, brandSlug: "sage", buyable: false, hasImage: false, price: 0 },
    ]);
    expect(groups[0]?.ids).toEqual([1, 2]);
  });
});

describe("colour tokens stripped in fallback", () => {
  it("removes colour and noise words from a code-less name", () => {
    const key = modelKey("tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ مشکی");
    expect(key).not.toMatch(/مشکی|رنگ/u);
    expect(key).toContain("خردکن");
    expect(modelKey("tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ سفید")).toBe(key);
  });

  it("stripColorTokens removes the longest token first", () => {
    expect(stripColorTokens("کتری سبز سرامیکی اسمگ")).toBe("کتری اسمگ");
    expect(stripColorTokens("جارو رزگلد")).toBe("جارو");
    expect(stripColorTokens("")).toBe("");
  });

  it("a compound colour disappears from the fallback key", () => {
    expect(modelKey("تصفیه هوا دایسون سفید-طلایی")).not.toMatch(/سفید|طلایی/u);
  });

  it("never returns an empty key", () => {
    expect(modelKey("مشکی")).toBe("مشکی");
    expect(modelKey("")).toBe("");
  });
});

describe("primary selection priority", () => {
  const base = { key: "smeg klf03", brandSlug: "smeg" };

  it("prefers buyable, then image, then price, then id", () => {
    const groups = groupByModelKey([
      { id: 1, ...base, buyable: false, hasImage: true, price: 1_000 },
      { id: 2, ...base, buyable: true, hasImage: false, price: 9_000 },
      { id: 3, ...base, buyable: true, hasImage: true, price: 9_000 },
      { id: 4, ...base, buyable: true, hasImage: true, price: 8_000 },
    ]);
    expect(groups[0]?.primaryId).toBe(4);
  });

  it("falls back to the lowest id when everything ties", () => {
    const groups = groupByModelKey([
      { id: 7, ...base, buyable: false, hasImage: false, price: 0 },
      { id: 3, ...base, buyable: false, hasImage: false, price: 0 },
    ]);
    expect(groups[0]?.primaryId).toBe(3);
  });

  it("singletons never become a group", () => {
    expect(groupByModelKey([{ id: 1, ...base, buyable: true, hasImage: true, price: 1 }])).toEqual([]);
  });
});

describe("brand split", () => {
  it("one key never spans two brands", () => {
    const groups = groupByModelKey([
      { id: 1, key: "ecf01", brandSlug: "smeg", buyable: true, hasImage: true, price: 10 },
      { id: 2, key: "ecf01", brandSlug: "smeg", buyable: false, hasImage: true, price: 10 },
      { id: 3, key: "ecf01", brandSlug: "figaro", buyable: true, hasImage: true, price: 10 },
      { id: 4, key: "ecf01", brandSlug: "figaro", buyable: false, hasImage: true, price: 10 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.brandSlug).sort()).toEqual(["figaro", "smeg"]);
    expect(groups.find((g) => g.brandSlug === "smeg")?.ids).toEqual([1, 2]);
  });

  it("null brand members form their own group", () => {
    const groups = groupByModelKey([
      { id: 1, key: "k", brandSlug: null, buyable: false, hasImage: false, price: 0 },
      { id: 2, key: "k", brandSlug: null, buyable: false, hasImage: false, price: 0 },
      { id: 3, key: "k", brandSlug: "smeg", buyable: false, hasImage: false, price: 0 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.brandSlug).toBeNull();
  });
});

describe("deterministic", () => {
  it("the same input yields the same key and the same group order", () => {
    const name = "کتری برقی ساده اسمگ KLF03 رنگ کرم";
    expect(modelKey(name)).toBe(modelKey(name));
    const items = [
      { id: 2, key: "b", brandSlug: "smeg", buyable: false, hasImage: false, price: 0 },
      { id: 1, key: "a", brandSlug: "smeg", buyable: false, hasImage: false, price: 0 },
      { id: 3, key: "a", brandSlug: "smeg", buyable: false, hasImage: false, price: 0 },
      { id: 4, key: "b", brandSlug: "smeg", buyable: false, hasImage: false, price: 0 },
    ];
    expect(JSON.stringify(groupByModelKey(items))).toBe(JSON.stringify(groupByModelKey([...items].reverse())));
    expect(groupByModelKey(items).map((g) => g.key)).toEqual(["a", "b"]);
  });
});

describe.skipIf(!hasCorpus)("real catalogue", () => {
  type LegacyTerm = { name?: string; slug?: string };
  type LegacyAttribute = { taxonomy?: string | null; terms?: LegacyTerm[] };
  type LegacyProduct = {
    id: number;
    name: string;
    sku?: string;
    attributes?: LegacyAttribute[];
    prices?: { price?: string };
    is_purchasable?: boolean;
    images?: unknown[];
  };

  const products: LegacyProduct[] = readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => JSON.parse(readFileSync(`${PRODUCTS_DIR}/${d.name}/product.json`, "utf8")) as LegacyProduct);

  const brandOf = (p: LegacyProduct): string | null =>
    (p.attributes ?? []).find((a) => a.taxonomy === "pa_brand")?.terms?.[0]?.slug ?? null;

  it("reduces the 541 products to fewer cards without losing an id (v2 §6.3)", () => {
    expect(products).toHaveLength(541);
    const items = products.map((p) => ({
      id: p.id,
      key: modelKey(p.name, p.sku ?? null),
      brandSlug: brandOf(p),
      buyable: Boolean(p.is_purchasable) && Number.parseInt(p.prices?.price ?? "0", 10) > 0,
      hasImage: (p.images ?? []).length > 0,
      price: Number.parseInt(p.prices?.price ?? "0", 10) || 0,
    }));
    const groups = groupByModelKey(items);
    const grouped = new Set(groups.flatMap((g) => g.ids));
    const cards = products.length - grouped.size + groups.length;

    // Measured on the frozen extract (2026-08): 55 groups hold 178 of the 541 products, so the
    // grid drops to 418 cards without losing a single id (v2 §6.3 is a display grouping).
    expect(groups).toHaveLength(55);
    expect(grouped.size).toBe(178);
    expect(cards).toBe(418);
    // Nothing is lost: every grouped id is a real product id and every group has a primary member.
    for (const g of groups) {
      expect(g.ids).toContain(g.primaryId);
      expect(new Set(g.ids).size).toBe(g.ids.length);
    }
  });

  it("keys are stable across two runs over the whole catalogue", () => {
    const once = products.map((p) => modelKey(p.name, p.sku ?? null));
    const twice = products.map((p) => modelKey(p.name, p.sku ?? null));
    expect(twice).toEqual(once);
    // DATA QUIRK: product 38071 has an empty legacy name, so its key is empty too (never grouped).
    expect(once.filter((k) => k === "")).toHaveLength(1);
    expect(products.filter((p) => p.name.trim() === "")).toHaveLength(1);
  });
});
