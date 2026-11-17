import { describe, expect, it } from "vitest";
import { isShowcaseCard } from "../cards";
import type { ProductCard } from "../cards";
import { RELATED_PHOTOLESS_MAX, RELATED_SIZE, rankRelated } from "../products.service";

const IMAGE = { key: "media/x.jpg", w: 800, h: 1000, alt: "" } as unknown as NonNullable<ProductCard["image"]>;

function card(id: number, o: Partial<Pick<ProductCard, "image" | "available" | "onRequest">> = {}): ProductCard {
  return {
    id,
    slug: `p-${String(id)}`,
    displayName: `P${String(id)}`,
    brand: null,
    price: o.onRequest === true ? 0 : 1_000_000,
    onRequest: o.onRequest ?? false,
    available: o.available ?? true,
    lowStock: false,
    badges: [],
    variants: [],
    ...(o.image === undefined ? {} : { image: o.image }),
  } as unknown as ProductCard;
}

describe("isShowcaseCard", () => {
  it("needs a photograph, availability and a price", () => {
    expect(isShowcaseCard(card(1, { image: IMAGE }))).toBe(true);
    expect(isShowcaseCard(card(2))).toBe(false);
    expect(isShowcaseCard(card(3, { image: IMAGE, available: false }))).toBe(false);
    expect(isShowcaseCard(card(4, { image: IMAGE, onRequest: true }))).toBe(false);
  });
});

describe("rankRelated", () => {
  it("puts showcase cards first, keeps affinity order inside a tier, caps photo-less cards", () => {
    const pool = [
      card(1), // photo-less, first by affinity
      card(2, { image: IMAGE, available: false }), // photographed, out of stock
      card(3, { image: IMAGE }), // showcase
      card(4), // photo-less
      card(5, { image: IMAGE, onRequest: true }), // photographed, on request
      card(6, { image: IMAGE }), // showcase
      card(7), // photo-less
    ];
    expect(rankRelated(pool).map((c) => c.id)).toEqual([3, 6, 2, 5, 1]);
    expect(RELATED_PHOTOLESS_MAX).toBe(1);
  });

  it("never exceeds the rail size and tolerates an empty pool", () => {
    const pool = Array.from({ length: RELATED_SIZE + 5 }, (_, i) => card(i + 1, { image: IMAGE }));
    expect(rankRelated(pool)).toHaveLength(RELATED_SIZE);
    expect(rankRelated([])).toEqual([]);
  });

  it("a rail of only photo-less products keeps exactly one", () => {
    expect(rankRelated([card(1), card(2), card(3)]).map((c) => c.id)).toEqual([1]);
  });
});
