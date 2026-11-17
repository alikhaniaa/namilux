import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_KINDS,
  COLLECTION_KINDS,
  DISPLAY_NAME_MAX,
  type IMAGE_ROLES,
  type RELATION_KINDS,
} from "../../constants";
import {
  archiveProductSchema,
  attributeAdminSchema,
  brandAdminSchema,
  bulkPriceSchema,
  categoryAdminSchema,
  collectionAdminSchema,
  collectionRuleSchema,
  colorHexSchema,
  csvImportSchema,
  csvRowSchema,
  idParamSchema,
  mediaAltSchema,
  modelCodeSchema,
  productAdminSchema,
  productFilterSchema,
  setPriceSchema,
  stockAdjustSchema,
} from "../catalog-admin";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ULID2 = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const minimal = {
  slug: "kettle-klf04",
  name: "کتری برقی اسمگ مدل KLF04",
  displayName: "کتری برقی اسمگ",
  status: "draft" as const,
  visibility: "public" as const,
  price: 0,
};

describe("product defaults", () => {
  it("parses the minimal product with every documented default", () => {
    expect(productAdminSchema.parse(minimal)).toEqual({
      ...minimal,
      priceBasis: "manual",
      // the instalment site's price is derived unless a human pins it, so the flag defaults off
      instalmentPriceManual: false,
      stockPolicy: "track",
      allowBackorder: false,
      lowStockThreshold: 3,
      maxPerOrder: 5,
      shortHtml: "",
      descriptionHtml: "",
      categoryIds: [],
      collectionIds: [],
      images: [],
      specs: [],
      attributes: [],
      relations: [],
      robots: "index, follow",
    });
  });

  it("instalmentEligible is an optional boolean with NO default (an absent key keeps the stored value)", () => {
    expect("instalmentEligible" in productAdminSchema.parse(minimal)).toBe(false);
    expect(productAdminSchema.parse({ ...minimal, instalmentEligible: false }).instalmentEligible).toBe(false);
    expect(productAdminSchema.parse({ ...minimal, instalmentEligible: true }).instalmentEligible).toBe(true);
    for (const bad of ["false", 0, null]) {
      expect(() => productAdminSchema.parse({ ...minimal, instalmentEligible: bad }), String(bad)).toThrow();
    }
  });

  it("never accepts a derived column (stock, rating, views, search text)", () => {
    for (const extra of [{ stockQty: 5 }, { ratingAvg: 4.5 }, { ratingCount: 2 }, { viewCount: 10 }, { searchText: "x" }]) {
      expect(() => productAdminSchema.parse({ ...minimal, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });

  it("caps the display name at DISPLAY_NAME_MAX", () => {
    expect(DISPLAY_NAME_MAX).toBe(60);
    expect(productAdminSchema.parse({ ...minimal, displayName: "ک".repeat(60) }).displayName.length).toBe(60);
    expect(() => productAdminSchema.parse({ ...minimal, displayName: "ک".repeat(61) })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, displayName: "کت" })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, name: "" })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, slug: "a/b" })).toThrow();
  });

  it("saves an imported product whose robots still carries Yoast's directives, unchanged", () => {
    // 420 of 421 live products hold this string; refusing it made the editor unable to save any of them.
    const robots = "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large";
    expect(productAdminSchema.parse({ ...minimal, robots }).robots).toBe(robots);
    expect(() => productAdminSchema.parse({ ...minimal, robots: "index" })).toThrow();
  });
});

describe("optional specifications", () => {
  it("ignores blank, whitespace-only and inherited-group-only rows", () => {
    const specs = [
      { label: "", value: "", sort: 0 },
      { groupName: "مشخصات فنی", label: " \t", value: "\n ", sort: 1 },
    ];
    expect(productAdminSchema.parse({ ...minimal, specs }).specs).toEqual([]);
  });

  it("preserves real specifications between empty rows, including their order and group", () => {
    const first = { groupName: "فنی", label: "توان", value: "۱۵۰۰ وات", sort: 1 };
    const second = { groupName: null, label: "ظرفیت", value: "۱٫۷ لیتر", sort: 3 };
    const parsed = productAdminSchema.parse({ ...minimal, specs: [
      { label: "", value: "", sort: 0 }, first,
      { groupName: "فنی", label: "", value: "", sort: 2 }, second,
    ] });
    expect(parsed.specs).toEqual([first, second]);
    // The server parses the already normalized client payload again.
    expect(productAdminSchema.parse(parsed).specs).toEqual([first, second]);
  });

  it("explains partially filled rows at their original indices", () => {
    const parsed = productAdminSchema.safeParse({ ...minimal, specs: [
      { label: "", value: "", sort: 0 },
      { label: "توان", value: " ", sort: 1 },
      { label: "", value: "۱۵۰۰ وات", sort: 2 },
    ] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["specs", 1, "value"], message: "مقدار مشخصه را وارد کنید یا ردیف را حذف کنید." },
      { path: ["specs", 2, "label"], message: "عنوان مشخصه را وارد کنید یا ردیف را حذف کنید." },
    ]);
  });

  it("still bounds input rows and refuses malformed or oversized data", () => {
    expect(() => productAdminSchema.parse({ ...minimal, specs: Array.from({ length: 201 }, (_, sort) => ({ label: "", value: "", sort })) })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, specs: [null] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, specs: [{ label: 123, value: "", sort: 0 }] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, specs: [{ label: "ک".repeat(121), value: "وات", sort: 0 }] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, specs: [{ label: "توان", value: "ک".repeat(501), sort: 0 }] })).toThrow();
  });
});

describe("sale price rule", () => {
  it("accepts compareAt above a positive price and refuses everything else", () => {
    expect(productAdminSchema.parse({ ...minimal, price: 41_500_000, compareAtPrice: 48_000_000 }).compareAtPrice).toBe(
      48_000_000,
    );
    expect(productAdminSchema.parse({ ...minimal, price: 41_500_000, compareAtPrice: null }).compareAtPrice).toBe(null);
    const cheaper = productAdminSchema.safeParse({ ...minimal, price: 41_500_000, compareAtPrice: 40_000_000 });
    expect(cheaper.success).toBe(false);
    expect(cheaper.error?.issues[0]?.path).toEqual(["compareAtPrice"]);
    expect(() => productAdminSchema.parse({ ...minimal, price: 41_500_000, compareAtPrice: 41_500_000 })).toThrow();
    // an on-request item (price 0) carries no "was"
    expect(() => productAdminSchema.parse({ ...minimal, price: 0, compareAtPrice: 1 })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, price: -1 })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, price: 1.5 })).toThrow();
    expect(productAdminSchema.parse({ ...minimal, price: "۴۱٬۵۰۰٬۰۰۰" }).price).toBe(41_500_000);
  });

  it("setPriceSchema repeats the same rule", () => {
    expect(setPriceSchema.parse({ price: 41_500_000, compareAtPrice: 48_000_000, note: "افزایش ارز" })).toEqual({
      price: 41_500_000,
      compareAtPrice: 48_000_000,
      note: "افزایش ارز",
    });
    expect(setPriceSchema.parse({ price: 0, compareAtPrice: null }).price).toBe(0);
    expect(() => setPriceSchema.parse({ price: 41_500_000, compareAtPrice: 40_000_000 })).toThrow();
    expect(() => setPriceSchema.parse({ price: 41_500_000 })).toThrow(); // compareAtPrice is required (nullable, not optional)
    expect(() => setPriceSchema.parse({ price: 41_500_000, compareAtPrice: null, actor: "owner" })).toThrow();
  });
});

describe("fx rule", () => {
  it("fx pricing needs a positive base price and a currency", () => {
    expect(
      productAdminSchema.parse({ ...minimal, price: 41_500_000, priceBasis: "fx", basePrice: 380, baseCurrency: "EUR" })
        .basePrice,
    ).toBe(380);
    const noBase = productAdminSchema.safeParse({ ...minimal, priceBasis: "fx" });
    expect(noBase.success).toBe(false);
    expect(noBase.error?.issues[0]?.path).toEqual(["basePrice"]);
    expect(() => productAdminSchema.parse({ ...minimal, priceBasis: "fx", basePrice: 0, baseCurrency: "EUR" })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, priceBasis: "fx", basePrice: 380 })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, priceBasis: "fx", basePrice: 380, baseCurrency: "IRR" })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, priceBasis: "auto" })).toThrow();
  });
});

describe("uniqueness rules", () => {
  const img = (mediaId: string, role: (typeof IMAGE_ROLES)[number] = "gallery") => ({ mediaId, role, sort: 0, alt: "" });

  it("allows at most one primary category and no duplicate category", () => {
    expect(
      productAdminSchema.parse({ ...minimal, categoryIds: [{ id: 1, isPrimary: true }, { id: 2 }] }).categoryIds,
    ).toEqual([{ id: 1, isPrimary: true }, { id: 2, isPrimary: false }]);
    expect(() =>
      productAdminSchema.parse({
        ...minimal,
        categoryIds: [
          { id: 1, isPrimary: true },
          { id: 2, isPrimary: true },
        ],
      }),
    ).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, categoryIds: [{ id: 1 }, { id: 1 }] })).toThrow();
  });

  it("allows at most one primary image and no duplicate media", () => {
    expect(productAdminSchema.parse({ ...minimal, images: [img(ULID, "primary"), img(ULID2)] }).images.length).toBe(2);
    expect(() => productAdminSchema.parse({ ...minimal, images: [img(ULID, "primary"), img(ULID2, "primary")] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, images: [img(ULID), img(ULID)] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, images: [{ ...img(ULID), role: "hero" }] })).toThrow();
  });

  it("refuses duplicate collections, attributes and relations, and a relation to itself", () => {
    expect(() => productAdminSchema.parse({ ...minimal, collectionIds: [3, 3] })).toThrow();
    expect(productAdminSchema.parse({ ...minimal, collectionIds: [3, 4] }).collectionIds).toEqual([3, 4]);
    expect(() =>
      productAdminSchema.parse({
        ...minimal,
        attributes: [
          { attributeId: 1, valueText: "قرمز" },
          { attributeId: 1, valueNum: 2 },
        ],
      }),
    ).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, attributes: [{ attributeId: 1 }] })).toThrow();
    expect(productAdminSchema.parse({ ...minimal, attributes: [{ attributeId: 1, valueNum: 1.6 }] }).attributes.length).toBe(1);
    const rel = (relatedId: number, kind: (typeof RELATION_KINDS)[number] = "related") => ({ relatedId, kind, sort: 0 });
    expect(() => productAdminSchema.parse({ ...minimal, relations: [rel(2), rel(2)] })).toThrow();
    expect(productAdminSchema.parse({ ...minimal, relations: [rel(2), rel(2, "accessory")] }).relations.length).toBe(2);
    expect(() => productAdminSchema.parse({ ...minimal, id: 7, relations: [rel(7)] })).toThrow();
    expect(productAdminSchema.parse({ ...minimal, id: 7, relations: [rel(8)] }).id).toBe(7);
  });

  it("bounds the nested arrays and the spec fields", () => {
    expect(
      productAdminSchema.parse({ ...minimal, specs: [{ label: "توان", value: "۳۰۰۰ وات", sort: 0 }] }).specs.length,
    ).toBe(1);
    expect(() => productAdminSchema.parse({ ...minimal, specs: [{ label: "", value: "x", sort: 0 }] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, specs: [{ label: "توان", value: "", sort: 0 }] })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, collectionIds: Array.from({ length: 31 }, (_, i) => i + 1) })).toThrow();
    expect(() => productAdminSchema.parse({ ...minimal, images: Array.from({ length: 31 }, (_, i) => img(`${i}`)) })).toThrow();
  });
});

describe("model code / hex normalization", () => {
  it("uppercases the model code and lowercases the colour", () => {
    expect(modelCodeSchema.parse(" klf04bl ")).toBe("KLF04BL");
    expect(modelCodeSchema.parse("kl-f04/2 a")).toBe("KL-F04/2 A");
    expect(modelCodeSchema.parse("۰۴klf")).toBe("04KLF");
    for (const bad of ["-KLF04", "KLF#04", "کتری", "", "A".repeat(41)]) {
      expect(() => modelCodeSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(colorHexSchema.parse("#FFFFFF")).toBe("#ffffff");
    for (const bad of ["#fff", "ffffff", "#gggggg", "#ffffff ff", "", 1]) {
      expect(() => colorHexSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(productAdminSchema.parse({ ...minimal, modelCode: "klf04bl", colorHex: "#FF0000" }).colorHex).toBe("#ff0000");
  });
});

describe("stock adjust", () => {
  it("takes a non-zero delta with an allowed reason", () => {
    expect(stockAdjustSchema.parse({ delta: "۵", reason: "restock" })).toEqual({ delta: 5, reason: "restock" });
    expect(stockAdjustSchema.parse({ delta: -2, reason: "adjust", note: "شکستگی" }).delta).toBe(-2);
    expect(() => stockAdjustSchema.parse({ delta: 0, reason: "adjust" })).toThrow();
    expect(() => stockAdjustSchema.parse({ delta: 10_001, reason: "restock" })).toThrow();
    expect(() => stockAdjustSchema.parse({ delta: 1.5, reason: "restock" })).toThrow();
    for (const reason of ["sale", "cancel", "seed", "", null]) {
      expect(() => stockAdjustSchema.parse({ delta: 1, reason }), JSON.stringify(reason)).toThrow();
    }
    expect(() => stockAdjustSchema.parse({ stockQty: 10, reason: "restock" })).toThrow();

    expect(archiveProductSchema.parse({ redirectTo: "/shop/" })).toEqual({ redirectTo: "/shop/" });
    expect(archiveProductSchema.parse({ redirectTo: null })).toEqual({ redirectTo: null });
    expect(() => archiveProductSchema.parse({ redirectTo: "/shop" })).toThrow();
    expect(() => archiveProductSchema.parse({})).toThrow();
  });
});

describe("bulk price scope×op", () => {
  it("takes a discriminated scope and a discriminated operation", () => {
    expect(bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "percent", value: 10 } })).toEqual({
      scope: { kind: "brand", id: 24 },
      op: { kind: "percent", value: 10 },
      applyTo: "price",
    });
    expect(bulkPriceSchema.parse({ scope: { kind: "selection", ids: [1, 2] }, op: { kind: "set", value: 41_500_000 } }).op).toEqual({
      kind: "set",
      value: 41_500_000,
    });
    expect(
      bulkPriceSchema.parse({ scope: { kind: "filter", filter: { q: "کتری" } }, op: { kind: "round", to: 100_000 }, applyTo: "both" })
        .applyTo,
    ).toBe("both");
    expect(bulkPriceSchema.parse({ scope: { kind: "category", id: 3 }, op: { kind: "fixed", value: -500_000 } }).op).toEqual({
      kind: "fixed",
      value: -500_000,
    });
    expect(bulkPriceSchema.parse({ scope: { kind: "collection", id: 9 }, op: { kind: "percent", value: -90 } }).op.kind).toBe("percent");
  });

  it("refuses an out-of-range operation, an empty selection and an unknown scope", () => {
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "percent", value: -95 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "percent", value: 501 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "round", to: 5000 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "selection", ids: [] }, op: { kind: "percent", value: 10 } })).toThrow();
    expect(() =>
      bulkPriceSchema.parse({ scope: { kind: "selection", ids: Array.from({ length: 2001 }, (_, i) => i + 1) }, op: { kind: "percent", value: 10 } }),
    ).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "tag", id: 1 }, op: { kind: "percent", value: 10 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "multiply", value: 2 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24, extra: 1 }, op: { kind: "percent", value: 10 } })).toThrow();
    expect(() => bulkPriceSchema.parse({ scope: { kind: "brand", id: 24 }, op: { kind: "percent", value: 10 }, applyTo: "cost" })).toThrow();
  });

  it("productFilterSchema is a bounded, strict filter", () => {
    expect(productFilterSchema.parse({ status: ["draft", "active"], stockState: "low", priceState: "on_request" })).toEqual({
      status: ["draft", "active"],
      stockState: "low",
      priceState: "on_request",
    });
    expect(productFilterSchema.parse({})).toEqual({});
    expect(() => productFilterSchema.parse({ stockState: "gone" })).toThrow();
    expect(() => productFilterSchema.parse({ missing: ["video"] })).toThrow();
    expect(() => productFilterSchema.parse({ brandIds: Array.from({ length: 51 }, (_, i) => i + 1) })).toThrow();
    expect(() => productFilterSchema.parse({ q: "x".repeat(121) })).toThrow();
    expect(() => productFilterSchema.parse({ sort: "price_asc" })).toThrow();
  });
});

describe("csv rows", () => {
  it("needs one identifier and folds the price", () => {
    expect(csvRowSchema.parse({ sku: "X", price: "۴۱٬۵۰۰٬۰۰۰" })).toEqual({ sku: "X", price: 41_500_000 });
    expect(csvRowSchema.parse({ id: 1044 }).id).toBe(1044);
    expect(csvRowSchema.parse({ slug: "kettle" }).slug).toBe("kettle");
    const noId = csvRowSchema.safeParse({});
    expect(noId.success).toBe(false);
    expect(noId.error?.issues[0]?.path).toEqual(["id"]);
    expect(() => csvRowSchema.parse({ sku: "X", stockQty: 100_001 })).toThrow();
    expect(() => csvRowSchema.parse({ sku: "X", status: "deleted" })).toThrow();
    expect(() => csvRowSchema.parse({ sku: "X", displayName: "ک".repeat(61) })).toThrow();
    expect(() => csvRowSchema.parse({ sku: "X", brand: "Smeg" })).toThrow();

    expect(csvImportSchema.parse({ rows: [{ sku: "X" }] })).toEqual({ rows: [{ sku: "X" }], dryRun: true });
    expect(csvImportSchema.parse({ rows: [{ sku: "X" }], dryRun: false }).dryRun).toBe(false);
    expect(() => csvImportSchema.parse({ rows: [] })).toThrow();
    expect(() => csvImportSchema.parse({ rows: Array.from({ length: 5001 }, () => ({ sku: "X" })) })).toThrow();
  });
});

describe("category/brand/collection/attribute", () => {
  it("category and brand carry the seo fields and their own slug rules", () => {
    expect(categoryAdminSchema.parse({ slug: "کتری-برقی", name: "کتری برقی", status: "active", sort: 0 })).toEqual({
      slug: "کتری-برقی",
      name: "کتری برقی",
      descriptionHtml: "",
      status: "active",
      inSitemap: true,
      sort: 0,
      // `robots` and `parentId` carry defaults now - the upsert services read them unconditionally.
      parentId: null,
      robots: "index, follow",
    });
    expect(() => categoryAdminSchema.parse({ slug: "a/b", name: "x", status: "active", sort: 0 })).toThrow();
    expect(() => categoryAdminSchema.parse({ slug: "a", name: "x", status: "deleted", sort: 0 })).toThrow();
    expect(categoryAdminSchema.parse({ slug: "a", name: "x", status: "hidden", sort: 0, parentId: null }).parentId).toBe(null);

    expect(brandAdminSchema.parse({ slug: "smeg", nameFa: "اسمگ", nameEn: "Smeg", sort: 0 })).toEqual({
      slug: "smeg",
      nameFa: "اسمگ",
      nameEn: "Smeg",
      storyHtml: "",
      isActive: true,
      sort: 0,
      robots: "index, follow",
    });
    expect(() => brandAdminSchema.parse({ slug: "Smeg", nameFa: "اسمگ", nameEn: "Smeg", sort: 0 })).toThrow();
    expect(() => brandAdminSchema.parse({ slug: "smeg", nameFa: "", nameEn: "Smeg", sort: 0 })).toThrow();
    expect(() => brandAdminSchema.parse({ slug: "smeg", nameFa: "اسمگ", nameEn: "Smeg", sort: 0, logo: "x" })).toThrow();
  });

  it("collection rule and window", () => {
    expect(collectionRuleSchema.parse({ priceMin: 1, priceMax: 5 })).toEqual({ priceMin: 1, priceMax: 5 });
    const inverted = collectionRuleSchema.safeParse({ priceMin: 5, priceMax: 1 });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(["priceMax"]);
    expect(() => collectionRuleSchema.parse({ tags: [""] })).toThrow();
    expect(() => collectionRuleSchema.parse({ onSale: "yes" })).toThrow();

    const base = { slug: "nowruz", name: "نوروز", kind: "campaign" as const, status: "active" as const, sort: 0 };
    expect(collectionAdminSchema.parse(base)).toEqual({ ...base, descriptionHtml: "", isNav: false, parentId: null, rule: null, robots: "index, follow" });
    for (const kind of COLLECTION_KINDS) expect(collectionAdminSchema.parse({ ...base, kind }).kind).toBe(kind);
    expect(
      collectionAdminSchema.parse({ ...base, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" }).endsAt,
    ).toBe("2026-02-01T00:00:00Z");
    const bad = collectionAdminSchema.safeParse({
      ...base,
      startsAt: "2026-02-01T00:00:00Z",
      endsAt: "2026-01-01T00:00:00Z",
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["endsAt"]);
    expect(() => collectionAdminSchema.parse({ ...base, kind: "flash" })).toThrow();
    expect(() => collectionAdminSchema.parse({ ...base, productIds: Array.from({ length: 2001 }, (_, i) => i + 1) })).toThrow();
    expect(collectionAdminSchema.parse({ ...base, rule: null }).rule).toBe(null);
  });

  it("attributes need a lowercase key and a known kind", () => {
    expect(attributeAdminSchema.parse({ key: "color", label: "رنگ", kind: "color", sort: 0 })).toEqual({
      key: "color",
      label: "رنگ",
      kind: "color",
      isFilterable: false,
      isComparable: false,
      sort: 0,
    });
    for (const kind of ATTRIBUTE_KINDS) expect(attributeAdminSchema.parse({ key: "k", label: "l", kind, sort: 0 }).kind).toBe(kind);
    expect(() => attributeAdminSchema.parse({ key: "Color", label: "رنگ", kind: "color", sort: 0 })).toThrow();
    expect(() => attributeAdminSchema.parse({ key: "color", label: "", kind: "color", sort: 0 })).toThrow();
    expect(() => attributeAdminSchema.parse({ key: "color", label: "رنگ", kind: "enum", sort: 0 })).toThrow();
    expect(() => attributeAdminSchema.parse({ key: "color", label: "رنگ", kind: "color", sort: 0, values: [] })).toThrow();

    expect(mediaAltSchema.parse({ alt: " کتری برقی " })).toEqual({ alt: "کتری برقی" });
    expect(() => mediaAltSchema.parse({ alt: "x".repeat(201) })).toThrow();
    expect(() => mediaAltSchema.parse({ alt: "x", mediaId: ULID })).toThrow();
    expect(idParamSchema.parse({ id: "۱۰۴۴" })).toEqual({ id: 1044 });
    expect(() => idParamSchema.parse({ id: 0 })).toThrow();
  });
});


describe("daily catalog updates", () => {
  it("allows active products without known dimensions or weight", () => {
    expect(productAdminSchema.safeParse({ ...minimal, status: "active", weightG: null, lengthMm: null, widthMm: null, heightMm: null }).success).toBe(true);
  });
  it("validates the prices attached to a bulk preview", () => {
    const input = { scope: { kind: "selection", ids: [1] }, op: { kind: "percent", value: 10 }, expected: [{ id: 1, price: 1000, compareAt: null }] };
    expect(bulkPriceSchema.safeParse(input).success).toBe(true);
    expect(bulkPriceSchema.safeParse({ ...input, expected: [{ id: 1, price: -1, compareAt: null }] }).success).toBe(false);
    expect(bulkPriceSchema.safeParse({ ...input, expected: [] }).success).toBe(false);
  });
});
