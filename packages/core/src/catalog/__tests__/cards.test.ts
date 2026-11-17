import { describe, expect, it } from "vitest";
import {
  MAX_BADGES,
  NEW_DAYS,
  availableQty,
  badgesFor,
  discountPercent,
  isAvailable,
  isLowStock,
  isNew,
  isOnRequest,
  isOnSale,
  toProductCard,
  variantSwatchesFor,
  type ImageRef,
  type ProductCardSource,
  type VariantSwatch,
} from "../cards";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-26T09:00:00.000Z");
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();

const img = (key: string): ImageRef => ({
  key,
  alt: "کتری برقی درجه‌دار",
  width: 1200,
  height: 1500,
});

const sibling = (productId: number, over: Partial<VariantSwatch> = {}): VariantSwatch => ({
  productId,
  slug: `smeg-klf04-${productId}`,
  colorName: "مشکی",
  colorHex: "#111111",
  swatch: null,
  image: null,
  available: true,
  onRequest: false,
  ...over,
});

/** A buyable, tracked, well-stocked, year-old product - every test perturbs one axis. */
const src = (over: Partial<ProductCardSource> = {}): ProductCardSource => ({
  stockPolicy: "track",
  stockQty: 10,
  reservedQty: 0,
  allowBackorder: false,
  lowStockThreshold: 3,
  maxPerOrder: 5,
  id: 41546,
  slug: "smeg-klf04-cream",
  name: "کتری برقی اسمگ KLF04",
  displayName: "کتری برقی درجه‌دار",
  brand: { slug: "smeg", name: "اسمگ", nameEn: "Smeg" },
  modelCode: "KLF04",
  colorName: "کرم",
  colorHex: "#efe6d5",
  status: "active",
  visibility: "public",
  price: 41_500_000,
  compareAtPrice: null,
  publishedAt: daysAgo(365),
  ratingAvg: 0,
  ratingCount: 0,
  images: [],
  swatch: null,
  modelId: null,
  siblings: [],
  ...over,
});

const kinds = (s: ProductCardSource, now: Date = NOW): string[] =>
  badgesFor(s, now).map((b) => b.kind);

describe("availability", () => {
  it("on-request in stock", () => {
    const s = src({ price: 0, stockQty: 5 });
    expect(isOnRequest(s)).toBe(true);
    expect(isOnSale(s)).toBe(false);
    expect(isAvailable(s)).toBe(true);
    expect(kinds(s)).toEqual([]);

    const card = toProductCard(s, NOW);
    expect(card.onRequest).toBe(true);
    expect(card.available).toBe(true);
    expect(card.price).toBe(0);
    expect("compareAt" in card).toBe(false);

    expect(isOnRequest({ price: 1 })).toBe(false);
  });

  it("reserved exhausts stock", () => {
    const s = src({ stockPolicy: "track", stockQty: 3, reservedQty: 3 });
    expect(availableQty(s)).toBe(0);
    expect(isAvailable(s)).toBe(false);
    expect(isLowStock(s)).toBe(false);
    expect(kinds(s)).toEqual(["out"]);
    expect(toProductCard(s, NOW).available).toBe(false);

    // reserved beyond stock never goes negative
    expect(availableQty(src({ stockQty: 3, reservedQty: 9 }))).toBe(0);
    expect(availableQty(src({ stockQty: 3, reservedQty: 1 }))).toBe(2);
  });

  it("low stock threshold", () => {
    const low = src({ stockQty: 2, lowStockThreshold: 3 });
    expect(isLowStock(low)).toBe(true);
    expect(isAvailable(low)).toBe(true);
    expect(kinds(low)).toEqual(["last"]);
    expect(toProductCard(low, NOW).lowStock).toBe(true);

    // exactly at the threshold is still low; one above is not; zero is out, not low
    expect(isLowStock(src({ stockQty: 3, lowStockThreshold: 3 }))).toBe(true);
    expect(isLowStock(src({ stockQty: 4, lowStockThreshold: 3 }))).toBe(false);
    expect(isLowStock(src({ stockQty: 0, lowStockThreshold: 3 }))).toBe(false);
    // threshold 0 disables the «آخرین» line entirely
    expect(isLowStock(src({ stockQty: 1, lowStockThreshold: 0 }))).toBe(false);
    // reservations are part of the available qty
    expect(isLowStock(src({ stockQty: 5, reservedQty: 3, lowStockThreshold: 3 }))).toBe(true);
  });

  it("untracked always available", () => {
    const s = src({ stockPolicy: "untracked", stockQty: 0, reservedQty: 0 });
    expect(isAvailable(s)).toBe(true);
    expect(isLowStock(s)).toBe(false);
    expect(kinds(s)).toEqual([]);

    // untracked stays available even when the qty columns are nonsense
    expect(isAvailable(src({ stockPolicy: "untracked", stockQty: 0, reservedQty: 99 }))).toBe(true);
    expect(isLowStock(src({ stockPolicy: "untracked", stockQty: 1, lowStockThreshold: 3 }))).toBe(
      false,
    );
  });

  it("backorder available", () => {
    const s = src({ stockPolicy: "track", stockQty: 0, allowBackorder: true });
    expect(availableQty(s)).toBe(0);
    expect(isAvailable(s)).toBe(true);
    expect(isLowStock(s)).toBe(false);
    expect(kinds(s)).toEqual([]);
    expect(toProductCard(s, NOW).available).toBe(true);
  });
});

describe("pricing", () => {
  it("discount percent table", () => {
    const table: [price: number, compareAt: number, pct: number][] = [
      // the spec anatomy: 41٬500٬000 was 48٬000٬000 → «٪۱۴−»
      [41_500_000, 48_000_000, 14],
      [50_000_000, 100_000_000, 50],
      [90_000_000, 100_000_000, 10],
      // rounds to nearest, never floors: 13.54 → 14, 12.5 → 13
      [8_750_000, 10_000_000, 13],
      // clamped to 1 when the saving rounds to 0
      [99_960_000, 100_000_000, 1],
      // clamped to 99 when the saving rounds to 100
      [1_000, 100_000_000, 99],
      // not a sale → 0
      [48_000_000, 48_000_000, 0],
      [48_000_000, 41_500_000, 0],
      [0, 48_000_000, 0],
      [41_500_000, 0, 0],
    ];
    for (const [price, compareAt, pct] of table) {
      expect(discountPercent(price, compareAt)).toBe(pct);
    }
  });

  it("compare-at noise dropped", () => {
    const sale = src({ price: 41_500_000, compareAtPrice: 48_000_000 });
    expect(isOnSale(sale)).toBe(true);
    expect(toProductCard(sale, NOW).compareAt).toBe(48_000_000);

    // compare_at ≤ price, compare_at = null and price 0 are all data noise → the field is omitted
    for (const noise of [
      src({ price: 41_500_000, compareAtPrice: 41_500_000 }),
      src({ price: 41_500_000, compareAtPrice: 30_000_000 }),
      src({ price: 41_500_000, compareAtPrice: null }),
      src({ price: 0, compareAtPrice: 48_000_000 }),
    ]) {
      expect(isOnSale(noise)).toBe(false);
      const card = toProductCard(noise, NOW);
      expect("compareAt" in card).toBe(false);
      expect(card.badges.map((b) => b.kind)).not.toContain("sale");
    }
  });
});

describe("badges", () => {
  it("badge slot table", () => {
    const saleFacts = { price: 41_500_000, compareAtPrice: 48_000_000 };
    const table: [name: string, s: ProductCardSource, expected: string[]][] = [
      ["plain buyable", src(), []],
      ["new", src({ publishedAt: daysAgo(1) }), ["new"]],
      ["sale", src(saleFacts), ["sale"]],
      // start slot holds sale OR new, never both
      ["sale + new", src({ ...saleFacts, publishedAt: daysAgo(1) }), ["sale"]],
      ["last", src({ stockQty: 2 }), ["last"]],
      ["out", src({ stockQty: 0 }), ["out"]],
      // end slot holds out OR last, never both
      ["out + last threshold", src({ stockQty: 3, reservedQty: 3, lowStockThreshold: 3 }), ["out"]],
      ["sale + last", src({ ...saleFacts, stockQty: 2 }), ["sale", "last"]],
      ["sale + out", src({ ...saleFacts, stockQty: 0 }), ["sale", "out"]],
      // `new` is suppressed when the row is out
      ["new + out", src({ stockQty: 0, publishedAt: daysAgo(1) }), ["out"]],
      ["new + last", src({ stockQty: 2, publishedAt: daysAgo(1) }), ["new", "last"]],
      ["on request out", src({ price: 0, stockQty: 0 }), ["out"]],
    ];
    for (const [name, s, expected] of table) {
      expect(kinds(s), name).toEqual(expected);
      expect(badgesFor(s, NOW).length, name).toBeLessThanOrEqual(MAX_BADGES);
    }

    // the sale badge carries the percent the plate renders as «٪۱۴−»
    expect(badgesFor(src({ ...saleFacts, stockQty: 2 }), NOW)).toEqual([
      { kind: "sale", percent: 14 },
      { kind: "last" },
    ]);
  });

  it("new boundary", () => {
    expect(NEW_DAYS).toBe(30);
    // strict <: one day short is new, exactly NEW_DAYS ago is not
    expect(isNew({ publishedAt: daysAgo(NEW_DAYS - 1) }, NOW)).toBe(true);
    expect(isNew({ publishedAt: daysAgo(NEW_DAYS) }, NOW)).toBe(false);
    expect(isNew({ publishedAt: daysAgo(NEW_DAYS + 1) }, NOW)).toBe(false);
    expect(isNew({ publishedAt: new Date(NOW.getTime() - 1).toISOString() }, NOW)).toBe(true);
    // never published, and drifted data, are never new
    expect(isNew({ publishedAt: null }, NOW)).toBe(false);
    expect(isNew({ publishedAt: "not-a-date" }, NOW)).toBe(false);
    expect(kinds(src({ publishedAt: daysAgo(NEW_DAYS) }))).toEqual([]);
    expect(kinds(src({ publishedAt: daysAgo(NEW_DAYS - 1) }))).toEqual(["new"]);
  });
});

describe("toProductCard", () => {
  it("variants ordering", () => {
    // no model → no swatch row at all
    expect(variantSwatchesFor(src({ modelId: null }))).toEqual([]);
    expect(toProductCard(src({ modelId: null }), NOW).variants).toEqual([]);

    const s = src({
      id: 41546,
      modelId: 7,
      images: [img("p/41546/1.webp")],
      siblings: [sibling(41999), sibling(41000), sibling(41546, { slug: "duplicate" })],
    });
    const variants = variantSwatchesFor(s);
    expect(variants.map((v) => v.productId)).toEqual([41000, 41546, 41999]);

    // self is included, built from the source row (self wins over a repeated sibling)
    const self = variants[1];
    expect(self).toEqual({
      productId: 41546,
      slug: "smeg-klf04-cream",
      colorName: "کرم",
      colorHex: "#efe6d5",
      swatch: null,
      image: img("p/41546/1.webp"),
      available: true,
      onRequest: false,
    });

    // a null colour name becomes "" (VariantSwatch.colorName is not nullable) and stock facts carry over
    const bare = variantSwatchesFor(
      src({ modelId: 7, colorName: null, colorHex: null, price: 0, stockQty: 0 }),
    );
    expect(bare).toHaveLength(1);
    expect(bare[0]?.colorName).toBe("");
    expect(bare[0]?.available).toBe(false);
    expect(bare[0]?.onRequest).toBe(true);
    expect(bare[0]?.image).toBeNull();
  });

  it("image fallback chain", () => {
    // 245 legacy products have no usable image at all → both keys are absent, not undefined values
    const none = toProductCard(src({ images: [] }), NOW);
    expect("image" in none).toBe(false);
    expect("images2" in none).toBe(false);

    // one usable image → no hover partner
    const one = toProductCard(src({ images: [img("a.webp")] }), NOW);
    expect(one.image).toEqual(img("a.webp"));
    expect("images2" in one).toBe(false);

    // the repo hands over usable refs in order (quarantined/absent primary already dropped),
    // so the card takes the first two: here the primary was quarantined and gallery 2/3 win
    const many = toProductCard(src({ images: [img("g2.webp"), img("g3.webp"), img("g4.webp")] }), NOW);
    expect(many.image).toEqual(img("g2.webp"));
    expect(many.images2).toEqual(img("g3.webp"));
  });

  it("omits empty optionals and maps the rest", () => {
    const full = toProductCard(
      src({ modelCode: "KLF04", colorName: "کرم", ratingAvg: 4.5, ratingCount: 12 }),
      NOW,
    );
    expect(full.modelCode).toBe("KLF04");
    expect(full.colorName).toBe("کرم");
    expect(full.rating).toEqual({ avg: 4.5, count: 12 });
    expect(full.id).toBe(41546);
    expect(full.slug).toBe("smeg-klf04-cream");
    expect(full.displayName).toBe("کتری برقی درجه‌دار");
    expect(full.brand).toEqual({ slug: "smeg", name: "اسمگ", nameEn: "Smeg" });
    expect(full.publishedAt).toBe(daysAgo(365));

    const bare = toProductCard(src({ modelCode: "  ", colorName: null, ratingCount: 0 }), NOW);
    expect("modelCode" in bare).toBe(false);
    expect("colorName" in bare).toBe(false);
    expect("rating" in bare).toBe(false);

    // a brandless legacy product (the spec brand_id NULL) - the absence is typed, never a sentinel
    expect(toProductCard(src({ brand: null }), NOW).brand).toBeNull();
  });
});
