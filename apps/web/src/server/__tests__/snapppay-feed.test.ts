import type * as Core from "@namilux/core";
import type { ProductDetail } from "@namilux/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The feed must list the whole sellable catalogue. Card hydration answers at most 60 ids per call
 * (core's getProductCards cap), and a feed that asked for every id at once silently stopped there:
 * the first r40 staging copy served 50 of 225 products. The loader mock below keeps that cap.
 */
const { IDS, listFeed } = vi.hoisted(() => {
  const IDS = Array.from({ length: 230 }, (_, i) => i + 1).filter((id) => id % 10 !== 0);
  return { IDS, listFeed: vi.fn(async (_db: unknown, input: { page: number; size: number; id?: number; slug?: string }) => {
    const matching = IDS.filter((id) => input.id !== undefined ? id === input.id : input.slug !== undefined ? `p-${id}` === input.slug : true);
    return { total: matching.length, slugs: matching.slice((input.page - 1) * input.size, input.page * input.size).map((id) => `p-${id}`) };
  }) };
});

vi.mock("@/env", () => ({ env: { SITE_MODE: "main", SITE_ORIGIN: "https://namilux.ir" } }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@namilux/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  listSnapppayFeedProducts: listFeed,
}));
vi.mock("@/server/loaders/catalog", () => ({
  loadCategory: vi.fn(async () => null),
  loadProduct: vi.fn(async (slug: string) => {
    const id = Number(slug.slice(2));
    return {
      id,
      slug,
      displayName: `محصول ${id}`,
      name: `Product ${id}`,
      brand: { slug: "smeg", name: "اسمگ", nameEn: "Smeg" },
      modelCode: `M${id}`,
      price: id % 10 === 0 ? 0 : 1_000_000,
      onRequest: id % 10 === 0,
      available: true,
      instalmentEligible: true,
      gallery: [],
      specs: [],
      categories: [],
    } as unknown as ProductDetail;
  }),
}));

const { snapppayFeedOne, snapppayFeedPage } = await import("../snapppay-feed");

beforeEach(() => {
  listFeed.mockClear();
});

describe("snapppay feed rows", () => {
  it("counts and pages the whole sellable catalogue, past the card loader's 60-id cap", async () => {
    // 230 public products, every tenth on request (price 0): 207 can be sold
    const first = await snapppayFeedPage(1, 100);
    expect(first).toMatchObject({ page: 1, size: 100, total: 207, total_pages: 3 });
    expect(first.products).toHaveLength(100);
    expect(first.products[0]?.id).toBe("1");

    const last = await snapppayFeedPage(3, 100);
    expect(last.products.map((p) => p.id)).toStrictEqual(["223", "224", "225", "226", "227", "228", "229"]);

    expect(IDS).toHaveLength(207);
    expect(listFeed).toHaveBeenLastCalledWith({}, { page: 3, size: 100 });
  });

  it("finds a single product beyond the first 60 ids, and never an on-request one", async () => {
    expect((await snapppayFeedOne({ id: "229" }))?.id).toBe("229");
    expect((await snapppayFeedOne({ slug: "p-201" }))?.id).toBe("201");
    expect(await snapppayFeedOne({ id: "230" })).toBeNull();
  });
});
