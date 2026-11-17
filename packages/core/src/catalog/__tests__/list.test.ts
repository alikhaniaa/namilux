import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brands,
  categories as categoriesRef,
  collectionProducts,
  collections,
  productCategories,
  products,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { PlpState } from "../../url";
import { SORT_KEYS, orderByPlan } from "../sort";
import {
  MAX_PAGE,
  PAGE_SIZE,
  NEW_SCOPE_DAYS,
  type ListPlan,
  type ProductQuery,
  type WhereTerm,
  isFiltered,
  listProducts,
  normalizeState,
  planQuery,
} from "../list";

/** A state with an unknown sort / a hostile page can only be built by widening the type. */
const state = (s: Record<string, unknown>): PlpState => s;
const query = (q: Record<string, unknown>): ProductQuery => q as ProductQuery;

const kinds = (plan: ListPlan): string[] => plan.where.map((t) => t.kind);

const term = <K extends WhereTerm["kind"]>(
  plan: ListPlan,
  kind: K,
): Extract<WhereTerm, { kind: K }> | undefined =>
  plan.where.find((t): t is Extract<WhereTerm, { kind: K }> => t.kind === kind);

const expectAppError = (fn: () => unknown, code: ErrorCode): void => {
  let thrown: unknown;
  try {
    fn();
  } catch (e: unknown) {
    thrown = e;
  }
  expect(isAppError(thrown)).toBe(true);
  expect(isAppError(thrown) ? thrown.code : null).toBe(code);
};

describe("planQuery", () => {
  it("plan for category scope with brand filter", () => {
    const plan = planQuery(query({ scope: { kind: "category", id: 5 }, brand: ["smeg"], page: 2 }));

    // EDGE CASE: where [base, category_in, brand_in], offset 30, filtered true.
    expect(kinds(plan)).toEqual(["base", "category_in", "brand_in"]);
    expect(term(plan, "category_in")?.ids).toEqual([5]);
    expect(plan.offset).toBe(PAGE_SIZE);
    expect(plan.limit).toBe(PAGE_SIZE);
    expect(plan.page).toBe(2);
    expect(plan.filtered).toBe(true);
    expect(plan.sort).toBe("recommended");
    expect(plan.needsSold90d).toBe(false);
    expect(plan.facetScopeKey).toBe("category:5");
    expect(plan.scope).toEqual({ kind: "category", id: 5 });
  });

  it("base term is always first and filters follow the scope in URL order", () => {
    const plan = planQuery(
      query({
        scope: { kind: "collection", id: 9, slug: "coffee" },
        attr: { power: ["1500"] },
        avail: ["ready"],
        priceMin: 1_000_000,
        color: ["مشکی"],
        collection: ["espresso"],
        brand: ["smeg"],
      }),
    );

    expect(kinds(plan)).toEqual([
      "base",
      "collection_in",
      "brand_in",
      "collection_in",
      "color_in",
      "price_between",
      "avail",
      "attr",
    ]);
    // The collection scope keys its facets on the slug (facets.facetScopeKey).
    expect(plan.facetScopeKey).toBe("collection:coffee");
    expect(plan.scope).toEqual({ kind: "collection", id: 9, slug: "coffee" });
    // DECISION under test: a slug filter cannot be resolved without a Db, so the pure plan states
    // the dimension with an empty id set (matches nothing) and listProducts fills it in.
    expect(plan.where[2]).toEqual({ kind: "brand_in", ids: [] });
    expect(term(plan, "color_in")?.values).toEqual(["مشکی"]);
  });

  it("scope requires an id for category, brand and collection", () => {
    for (const kind of ["category", "brand", "collection"] as const) {
      expectAppError(() => planQuery(query({ scope: { kind } })), "VALIDATION");
      expectAppError(() => planQuery(query({ scope: { kind, id: 0 } })), "VALIDATION");
      expectAppError(() => planQuery(query({ scope: { kind, id: -3 } })), "VALIDATION");
      expectAppError(() => planQuery(query({ scope: { kind, id: 1.5 } })), "VALIDATION");
      // A slug alone is not enough: the router resolves it to a row before it plans.
      expectAppError(() => planQuery(query({ scope: { kind, slug: "smeg" } })), "VALIDATION");
    }
  });

  it("scopes without an id plan their own term", () => {
    expect(kinds(planQuery(query({ scope: { kind: "all" } })))).toEqual(["base"]);
    expect(kinds(planQuery(query({ scope: { kind: "sale" } })))).toEqual(["base", "sale"]);
    expect(kinds(planQuery(query({ scope: { kind: "gifts" } })))).toEqual([
      "base",
      "gift_collections",
    ]);
    expect(planQuery(query({ scope: { kind: "gifts" } })).facetScopeKey).toBe("gifts");
  });

  it("page normalization", () => {
    // EDGE CASE: page 0 / negative / NaN → 1.
    for (const page of [undefined, 0, -3, Number.NaN, 1, 0.5, Number.POSITIVE_INFINITY]) {
      const plan = planQuery(query({ scope: { kind: "all" }, page }));
      expect(plan.page).toBe(1);
      expect(plan.offset).toBe(0);
    }
    expect(planQuery(query({ scope: { kind: "all" }, page: 2.7 })).page).toBe(2);
    expect(planQuery(query({ scope: { kind: "all" }, page: 3 })).offset).toBe(2 * PAGE_SIZE);

    const last = planQuery(query({ scope: { kind: "all" }, page: MAX_PAGE }));
    expect(last.page).toBe(MAX_PAGE);
    expect(last.offset).toBe((MAX_PAGE - 1) * PAGE_SIZE);

    // EDGE CASE: page 201 → NOT_FOUND (crawler-trap guard).
    expectAppError(
      () => planQuery(query({ scope: { kind: "all" }, page: MAX_PAGE + 1 })),
      "NOT_FOUND",
    );
    expectAppError(() => planQuery(query({ scope: { kind: "all" }, page: 10_000 })), "NOT_FOUND");
  });

  it("unknown sort falls back", () => {
    // EDGE CASE: sort "bogus" → recommended, filtered false.
    expect(normalizeState(state({ sort: "bogus" })).sort).toBe("recommended");
    const plan = planQuery(query({ scope: { kind: "all" }, sort: "bogus" }));
    expect(plan.sort).toBe("recommended");
    expect(plan.filtered).toBe(false);
    expect(plan.orderBy).toEqual(orderByPlan("recommended"));

    // A real, non-default sort is a filter for SEO purposes.
    expect(planQuery(query({ scope: { kind: "all" }, sort: "newest" })).filtered).toBe(true);
  });

  it("price bounds swap", () => {
    // EDGE CASE: priceMin 5_000_000 & priceMax 1_000_000 → swapped.
    const swapped = normalizeState({ priceMin: 5_000_000, priceMax: 1_000_000 });
    expect(swapped.priceMin).toBe(1_000_000);
    expect(swapped.priceMax).toBe(5_000_000);
    expect(term(planQuery(query({ scope: { kind: "all" }, priceMin: 5_000_000, priceMax: 1_000_000 })), "price_between")).toEqual({
      kind: "price_between",
      min: 1_000_000,
      max: 5_000_000,
    });

    // EDGE CASE: priceMin only → { min, max: null }.
    expect(term(planQuery(query({ scope: { kind: "all" }, priceMin: 1_000_000 })), "price_between")).toEqual({
      kind: "price_between",
      min: 1_000_000,
      max: null,
    });
    expect(term(planQuery(query({ scope: { kind: "all" }, priceMax: 5_000_000 })), "price_between")).toEqual({
      kind: "price_between",
      min: null,
      max: 5_000_000,
    });

    // "integers only": a fractional or negative bound is not a bound at all.
    expect(term(planQuery(query({ scope: { kind: "all" }, priceMin: 1.5 })), "price_between")).toBeUndefined();
    expect(term(planQuery(query({ scope: { kind: "all" }, priceMin: -1 })), "price_between")).toBeUndefined();
    expect(kinds(planQuery(query({ scope: { kind: "all" } })))).toEqual(["base"]);
  });

  it("avail dedupe", () => {
    // EDGE CASE: avail ["in","in"] → ["in"].
    expect(term(planQuery(query({ scope: { kind: "all" }, avail: ["in", "in"] })), "avail")?.keys).toEqual(["in"]);
    // Tokens are ordered by the enum so one state is one plan.
    expect(term(planQuery(query({ scope: { kind: "all" }, avail: ["ready", "in"] })), "avail")?.keys).toEqual([
      "in",
      "ready",
    ]);
    // EDGE CASE: avail [] → term omitted.
    expect(term(planQuery(query({ scope: { kind: "all" }, avail: [] })), "avail")).toBeUndefined();
    expect(term(planQuery(query({ scope: { kind: "all" }, avail: ["bogus"] })), "avail")).toBeUndefined();
  });

  it("ids scope validation and cap", () => {
    const plan = planQuery(query({ scope: { kind: "ids", ids: [3, 1, 2] } }));
    expect(kinds(plan)).toEqual(["base", "ids"]);
    // Order is preserved for compare / wishlist.
    expect(term(plan, "ids")?.ids).toEqual([3, 1, 2]);
    expect(plan.facetScopeKey).toBe("ids");

    // EDGE CASE: scope ids [] → VALIDATION; missing ids → VALIDATION.
    expectAppError(() => planQuery(query({ scope: { kind: "ids", ids: [] } })), "VALIDATION");
    expectAppError(() => planQuery(query({ scope: { kind: "ids" } })), "VALIDATION");
    expectAppError(() => planQuery(query({ scope: { kind: "ids", ids: [0, -1, 2.5] } })), "VALIDATION");

    // EDGE CASE: 61 entries → truncated to 60, not thrown.
    const many = Array.from({ length: 61 }, (_, i) => i + 1);
    const capped = planQuery(query({ scope: { kind: "ids", ids: many } }));
    expect(term(capped, "ids")?.ids).toEqual(many.slice(0, 60));
    expect(capped.scope.ids).toHaveLength(60);
    // Duplicates collapse before the cap.
    expect(term(planQuery(query({ scope: { kind: "ids", ids: [7, 7, 9] } })), "ids")?.ids).toEqual([7, 9]);
  });

  it("attr cleanup", () => {
    // EDGE CASE: attr {"":["x"]} or attr {"power":[]} → dropped.
    expect(kinds(planQuery(query({ scope: { kind: "all" }, attr: { "": ["x"] } })))).toEqual(["base"]);
    expect(kinds(planQuery(query({ scope: { kind: "all" }, attr: { power: [] } })))).toEqual(["base"]);
    expect(kinds(planQuery(query({ scope: { kind: "all" }, attr: { "Bad Key": ["x"] } })))).toEqual(["base"]);

    // One term per key, keys ASCII-sorted, values deduped: AND across keys, OR within.
    const plan = planQuery(
      query({ scope: { kind: "all" }, attr: { power: ["1500", "1500"], color_family: ["red"] } }),
    );
    expect(plan.where.slice(1)).toEqual([
      { kind: "attr", key: "color_family", values: ["red"] },
      { kind: "attr", key: "power", values: ["1500"] },
    ]);
  });

  it("new scope uses injected now", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const plan = planQuery(query({ scope: { kind: "new" } }), now);
    expect(kinds(plan)).toEqual(["base", "new"]);
    expect(term(plan, "new")?.sinceIso).toBe("2026-07-27T12:00:00.000Z");
    expect(plan.facetScopeKey).toBe("new");
    // The window is exactly NEW_SCOPE_DAYS days wide.
    const since = Date.parse(term(plan, "new")?.sinceIso ?? "");
    expect(now.getTime() - since).toBe(NEW_SCOPE_DAYS * 86_400_000);
  });

  it("bestselling needs sold_90d", () => {
    for (const sort of SORT_KEYS) {
      const plan = planQuery(query({ scope: { kind: "all" }, sort }));
      // EDGE CASE: bestselling sets needsSold90d true; every other sort false.
      expect(plan.needsSold90d).toBe(sort === "bestselling");
      expect(plan.orderBy).toEqual(orderByPlan(sort));
      // rules: every plan ends with id desc (stable paging).
      expect(plan.orderBy[plan.orderBy.length - 1]).toEqual({ column: "id", dir: "desc" });
    }
    expect(term(planQuery(query({ scope: { kind: "all" }, sort: "bestselling" })), "avail")).toBeUndefined();
    expect(planQuery(query({ scope: { kind: "all" }, sort: "bestselling" })).orderBy[0]?.column).toBe("sold_90d");
  });
});

describe("normalizeState", () => {
  it("resolves the defaults and drops the empties", () => {
    expect(normalizeState({})).toEqual({ sort: "recommended", page: 1 });
    expect(normalizeState({ brand: [], collection: [], color: [], avail: [], attr: {} })).toEqual({
      sort: "recommended",
      page: 1,
    });
    // Tokens are deduped and ordered exactly as plpUrl serializes them.
    expect(normalizeState({ brand: ["smeg", "dyson", "smeg"] }).brand).toEqual(["dyson", "smeg"]);
    // density is carried through (it is a layout choice, not a filter).
    expect(normalizeState({ density: 5 }).density).toBe(5);
    // MAX_PAGE is not applied here - planQuery answers NOT_FOUND for it.
    expect(normalizeState({ page: MAX_PAGE + 1 }).page).toBe(MAX_PAGE + 1);
  });
});

describe("isFiltered", () => {
  it("isFiltered table", () => {
    const table: [PlpState, boolean][] = [
      [{}, false],
      [{ sort: "recommended" }, false],
      [state({ sort: "bogus" }), false],
      // density is a layout choice, not a filter (the contract lists the six filter dimensions).
      [{ density: 5 }, false],
      [{ brand: [] }, false],
      [{ attr: {} }, false],
      [state({ attr: { "": ["x"] } }), false],
      [{ sort: "newest" }, true],
      [{ sort: "bestselling" }, true],
      [{ brand: ["smeg"] }, true],
      [{ collection: ["coffee"] }, true],
      [{ color: ["مشکی"] }, true],
      [{ priceMin: 1_000_000 }, true],
      [{ priceMax: 5_000_000 }, true],
      [{ avail: ["in"] }, true],
      [{ attr: { power: ["1500"] } }, true],
    ];
    for (const [input, expected] of table) {
      expect([JSON.stringify(input), isFiltered(input)]).toEqual([JSON.stringify(input), expected]);
    }
  });

  it("filtered ignores page", () => {
    // EDGE CASE / the spec: `?page=N` alone stays indexable with a self-canonical.
    expect(isFiltered({ page: 5 })).toBe(false);
    expect(isFiltered({ page: 0 })).toBe(false);
    expect(planQuery(query({ scope: { kind: "all" }, page: 5 })).filtered).toBe(false);
    expect(planQuery(query({ scope: { kind: "all" }, page: 5 })).offset).toBe(4 * PAGE_SIZE);
    // …but page + a filter is still filtered.
    expect(planQuery(query({ scope: { kind: "all" }, page: 5, brand: ["smeg"] })).filtered).toBe(true);
  });
});

// ---------------------------------------------------------------- listProducts (needs Postgres)

const PREFIX = "list-test";

type ListFixture = {
  rootId: number;
  childId: number;
  brandId: number;
  otherBrandId: number;
  collectionId: number;
  /** active + public, in the CHILD category (proves descendantIds), fixture brand, on sale */
  saleId: number;
  /** active + public, in the ROOT category, other brand, priced */
  otherId: number;
  /** active + public, in the ROOT category, fixture brand, price 0 */
  onRequestId: number;
  hiddenId: number;
  draftId: number;
  linkOnlyId: number;
};

async function seedListFixture(tx: Db): Promise<ListFixture> {
  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند فهرست", nameEn: "List Brand" })
    .returning({ id: brands.id });
  const [otherBrand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-other`, nameFa: "برند دیگر", nameEn: "Other Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;
  const otherBrandId = otherBrand?.id ?? 0;

  const [root] = await tx
    .insert(categoriesRef)
    .values({ slug: `${PREFIX}-root`, path: `${PREFIX}-root`, name: "ریشه" })
    .returning({ id: categoriesRef.id });
  const rootId = root?.id ?? 0;
  const [child] = await tx
    .insert(categoriesRef)
    .values({
      slug: `${PREFIX}-child`,
      path: `${PREFIX}-root/${PREFIX}-child`,
      name: "زیرشاخه",
      parentId: rootId,
    })
    .returning({ id: categoriesRef.id });
  const childId = child?.id ?? 0;

  const [collection] = await tx
    .insert(collections)
    .values({ slug: `${PREFIX}-live`, name: "مجموعهٔ فهرست", kind: "group", status: "active" })
    .returning({ id: collections.id });
  const collectionId = collection?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-sale`,
        name: "کالای حراج",
        displayName: "کالای حراج",
        brandId,
        status: "active",
        visibility: "public",
        price: 1_000_000,
        compareAtPrice: 2_000_000,
        stockPolicy: "track",
        stockQty: 5,
      },
      {
        slug: `${PREFIX}-other`,
        name: "کالای برند دیگر",
        displayName: "کالای برند دیگر",
        brandId: otherBrandId,
        status: "active",
        visibility: "public",
        price: 4_000_000,
        stockPolicy: "untracked",
      },
      {
        slug: `${PREFIX}-on-request`,
        name: "کالای استعلامی",
        displayName: "کالای استعلامی",
        brandId,
        status: "active",
        visibility: "public",
        price: 0,
        stockPolicy: "track",
        stockQty: 2,
      },
      {
        slug: `${PREFIX}-hidden`,
        name: "کالای پنهان",
        displayName: "کالای پنهان",
        brandId,
        status: "active",
        visibility: "hidden",
        price: 1_000_000,
        stockPolicy: "track",
        stockQty: 4,
      },
      {
        slug: `${PREFIX}-draft`,
        name: "کالای پیش‌نویس",
        displayName: "کالای پیش‌نویس",
        brandId,
        status: "draft",
        visibility: "public",
        price: 1_000_000,
        stockPolicy: "track",
        stockQty: 4,
      },
      {
        slug: `${PREFIX}-link-only`,
        name: "کالای فقط با لینک",
        displayName: "کالای فقط با لینک",
        brandId,
        status: "active",
        visibility: "link_only",
        price: 1_000_000,
        stockPolicy: "track",
        stockQty: 4,
      },
    ])
    .returning({ id: products.id, slug: products.slug });
  const idOf = (suffix: string): number => rows.find((r) => r.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const saleId = idOf("sale");
  const otherId = idOf("other");
  const onRequestId = idOf("on-request");
  const hiddenId = idOf("hidden");
  const draftId = idOf("draft");
  const linkOnlyId = idOf("link-only");

  // Every fixture row hangs under the ROOT category; only the sale row sits in the CHILD, so a
  // root-scoped query can only find it through categories.descendantIds.
  await tx.insert(productCategories).values([
    { productId: saleId, categoryId: childId, isPrimary: true },
    { productId: otherId, categoryId: rootId, isPrimary: true },
    { productId: onRequestId, categoryId: rootId, isPrimary: true },
    { productId: hiddenId, categoryId: rootId, isPrimary: true },
    { productId: draftId, categoryId: rootId, isPrimary: true },
    { productId: linkOnlyId, categoryId: rootId, isPrimary: true },
  ]);

  await tx.insert(collectionProducts).values([{ collectionId, productId: saleId, sort: 0 }]);

  return {
    rootId,
    childId,
    brandId,
    otherBrandId,
    collectionId,
    saleId,
    otherId,
    onRequestId,
    hiddenId,
    draftId,
    linkOnlyId,
  };
}

describe.skipIf(!hasTestDb())("listProducts against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: ListFixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedListFixture(tx)));

  it("category scope includes descendants and attaches scope facets", async () => {
    await run(async (tx, f) => {
      const result = await listProducts(tx, { scope: { kind: "category", id: f.rootId } });
      // rules: the base term lists active + public only - hidden, draft and link_only never appear,
      // and the CHILD category's product is included because the scope expands to descendantIds.
      expect([...result.items.map((c) => c.id)].sort()).toEqual(
        [f.saleId, f.otherId, f.onRequestId].sort(),
      );
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(PAGE_SIZE);
      // Facets are computed for the SCOPE, not for the filtered set.
      expect(result.facets.total).toBe(3);
      expect([...result.facets.brand.map((o) => o.value)].sort()).toEqual(
        [`${PREFIX}-brand`, `${PREFIX}-other`].sort(),
      );
      expect(result.facets.collection.map((o) => o.value)).toEqual([`${PREFIX}-live`]);
      // the price facet covers PRICED rows only (the on-request row is excluded)
      expect(result.facets.price).toEqual({ min: 1_000_000, max: 4_000_000 });
      expect(result.facets.avail).toEqual({ in: 3, sale: 1, ready: 2 });
    });
  }, 30_000);

  it("brand and collection slugs resolve to ids, an unknown slug fails closed", async () => {
    await run(async (tx, f) => {
      const byBrand = await listProducts(tx, {
        scope: { kind: "category", id: f.rootId },
        brand: [`${PREFIX}-other`],
      });
      expect(byBrand.items.map((c) => c.id)).toEqual([f.otherId]);
      // …but the SCOPE facets are unchanged: a filter never narrows the chips it was chosen from.
      expect(byBrand.facets.total).toBe(3);

      const byCollection = await listProducts(tx, {
        scope: { kind: "category", id: f.rootId },
        collection: [`${PREFIX}-live`],
      });
      expect(byCollection.items.map((c) => c.id)).toEqual([f.saleId]);

      // DECISION under test: an unresolved slug becomes an EMPTY id set, so it matches nothing
      // (fail closed) instead of widening the result to the whole scope.
      const unknown = await listProducts(tx, {
        scope: { kind: "category", id: f.rootId },
        brand: ["no-such-brand"],
      });
      expect(unknown.items).toEqual([]);
      expect(unknown.total).toBe(0);
    });
  }, 30_000);

  it("result page past the end returns items [] with the correct total", async () => {
    await run(async (tx, f) => {
      // EDGE CASE: a page past the last one → items [], total unchanged (the UI disables «نمایش بیشتر»).
      const past = await listProducts(tx, { scope: { kind: "category", id: f.rootId }, page: 2 });
      expect(past.items).toEqual([]);
      expect(past.total).toBe(3);
      expect(past.page).toBe(2);
      // a genuinely empty scope stays 0 on page 1 (no probe round trip)
      const empty = await listProducts(tx, {
        scope: { kind: "category", id: f.childId },
        brand: ["nope"],
      });
      expect(empty.total).toBe(0);
    });
  }, 30_000);

  it("ids scope keeps the given order and has no facets", async () => {
    await run(async (tx, f) => {
      const order = [f.onRequestId, f.saleId, f.otherId];
      const result = await listProducts(tx, { scope: { kind: "ids", ids: order } });
      // rules: "ids → explicit ids in the given order (compare, wishlist)".
      expect(result.items.map((c) => c.id)).toEqual(order);
      // rules: "scope ids has no facets - compare/wishlist never show filters".
      expect(result.facets.brand).toEqual([]);
      expect(result.facets.total).toBe(order.length);
      // a link_only / hidden id in the list drops out of the grid instead of leaking a row
      const mixed = await listProducts(tx, {
        scope: { kind: "ids", ids: [f.linkOnlyId, f.hiddenId, f.saleId] },
      });
      expect(mixed.items.map((c) => c.id)).toEqual([f.saleId]);
    });
  }, 30_000);

  it("sort and price filters reach the SQL", async () => {
    await run(async (tx, f) => {
      const cheapFirst = await listProducts(tx, {
        scope: { kind: "category", id: f.rootId },
        sort: "price_asc",
      });
      // on-request rows sort last on a price sort (sort.orderByPlan puts price_is_zero first)
      expect(cheapFirst.items.map((c) => c.id)).toEqual([f.saleId, f.otherId, f.onRequestId]);

      const bounded = await listProducts(tx, {
        scope: { kind: "category", id: f.rootId },
        priceMin: 2_000_000,
        priceMax: 5_000_000,
      });
      // rules: price bounds implicitly exclude on-request rows (price > 0).
      expect(bounded.items.map((c) => c.id)).toEqual([f.otherId]);

      const onSale = await listProducts(tx, { scope: { kind: "sale" } });
      expect(onSale.items.map((c) => c.id)).toContain(f.saleId);
      expect(onSale.items.map((c) => c.id)).not.toContain(f.otherId);
    });
  }, 30_000);
});
