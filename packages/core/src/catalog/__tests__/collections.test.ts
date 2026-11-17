import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  brands as brandsTable,
  categories as categoriesTable,
  collectionProducts as collectionProductsTable,
  collections as collectionsTable,
  eq,
  productCategories,
  products as productsTable,
  sql,
} from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

const enqueue = vi.fn(async () => "job-id");
vi.mock("../../jobs", () => ({
  backoffMinutes: () => 1,
  jobs: { enqueue: (...args: unknown[]) => enqueue(...(args as [])) },
}));

import {
  collectionProductIds,
  collectionRuleSchema,
  getCollectionBySlug,
  listCollections,
  previewRuleCount,
  ruleMatches,
  ruleToPlan,
  upsertCollection,
} from "../collections";
import type { CollectionTile, RuleProductFacts } from "../collections";
import type { WhereTerm } from "../list";
import type { Actor, CollectionRule } from "../../types";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";

const ACTOR: Actor = { type: "staff", id: "staff-test" };
/** The `tags` guard rejects before any query runs, so that test needs no connection. */
const NO_DB = {} as unknown as Db;

async function expectAppError(promise: Promise<unknown>, code: ErrorCode, reason?: string): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(isAppError(err)).toBe(true);
    if (!isAppError(err)) return;
    expect(err.code).toBe(code);
    if (reason !== undefined) expect(err.details).toMatchObject({ reason });
    return;
  }
  throw new Error(`expected an AppError ${code}`);
}

// ── pure: the rule evaluator ───────────────────────────────────────────────────────────────────

const facts = (over: Partial<RuleProductFacts> = {}): RuleProductFacts => ({
  brandId: 24,
  categoryIds: [5, 9],
  price: 41_500_000,
  compareAtPrice: null,
  available: true,
  ...over,
});

describe("empty rule matches all", () => {
  it("{} accepts every product", () => {
    expect(ruleMatches({}, facts())).toBe(true);
    expect(ruleMatches({}, facts({ brandId: null, categoryIds: [], price: 0, available: false }))).toBe(true);
    expect(ruleToPlan({})).toEqual([]);
  });

  it("an EMPTY id list is a present key that matches nothing (fail closed)", () => {
    expect(ruleMatches({ brandIds: [] }, facts())).toBe(false);
    expect(ruleMatches({ categoryIds: [] }, facts())).toBe(false);
  });
});

describe("brand+onSale AND", () => {
  const rule: CollectionRule = { brandIds: [24], onSale: true };

  it("brand 24 not on sale → false", () => {
    expect(ruleMatches(rule, facts({ compareAtPrice: null }))).toBe(false);
  });

  it("brand 24 on sale → true", () => {
    expect(ruleMatches(rule, facts({ compareAtPrice: 48_000_000 }))).toBe(true);
  });

  it("another brand on sale → false", () => {
    expect(ruleMatches(rule, facts({ brandId: 52, compareAtPrice: 48_000_000 }))).toBe(false);
  });

  it("a brandless product never matches a brand rule", () => {
    expect(ruleMatches({ brandIds: [24] }, facts({ brandId: null }))).toBe(false);
  });

  it("compare_at ≤ price is not a sale, and price 0 is never a sale", () => {
    expect(ruleMatches({ onSale: true }, facts({ compareAtPrice: 41_500_000 }))).toBe(false);
    expect(ruleMatches({ onSale: true }, facts({ price: 0, compareAtPrice: 10 }))).toBe(false);
  });
});

describe("category ancestors", () => {
  it("a product filed under a descendant carries the ancestor in its facts", () => {
    // facts.categoryIds is "incl. ancestors" (contract), so naming the parent matches the child
    expect(ruleMatches({ categoryIds: [5] }, facts({ categoryIds: [5, 9] }))).toBe(true);
    expect(ruleMatches({ categoryIds: [5] }, facts({ categoryIds: [7] }))).toBe(false);
  });
});

describe("inStock includes on-request", () => {
  it("an available on-request product is in stock", () => {
    expect(ruleMatches({ inStock: true }, facts({ price: 0, available: true }))).toBe(true);
    expect(ruleMatches({ inStock: true }, facts({ available: false }))).toBe(false);
  });
});

describe("price bound excludes on-request", () => {
  const cases: [rule: CollectionRule, price: number, expected: boolean][] = [
    [{ priceMin: 1 }, 0, false],
    [{ priceMin: 0 }, 0, false],
    [{ priceMax: 10 }, 0, false],
    [{ priceMin: 1 }, 1, true],
    [{ priceMin: 10, priceMax: 20 }, 10, true],
    [{ priceMin: 10, priceMax: 20 }, 20, true],
    [{ priceMin: 10, priceMax: 20 }, 21, false],
    [{ priceMin: 10, priceMax: 20 }, 9, false],
  ];

  it.each(cases)("%j with price %i → %s", (rule, price, expected) => {
    expect(ruleMatches(rule, facts({ price }))).toBe(expected);
  });
});

describe("tags rejected by schema", () => {
  it("a rule carrying tags is refused before it can be counted or stored", async () => {
    // DECISION (module rules): ../../validation/catalog-admin owns `collectionRuleSchema` and its own
    // contract still accepts up to 20 tags, so the guard lives in collections.ts. Documented in
    // the spec; this test pins the behaviour the storefront depends on.
    await expectAppError(previewRuleCount(NO_DB, { tags: ["x"] }), "VALIDATION", "tags_not_supported");
    expect(collectionRuleSchema.safeParse({ tags: [] }).success).toBe(true);
    expect(collectionRuleSchema.safeParse({ priceMin: 5, priceMax: 1 }).success).toBe(false);
  });

  it("tags is ignored by both evaluators (P0 has no product tags)", () => {
    expect(ruleMatches({ tags: [] }, facts())).toBe(true);
    expect(ruleToPlan({ tags: ["x"] })).toEqual([]);
  });
});

describe("ruleToPlan mirrors ruleMatches", () => {
  /** The `WhereTerm` vocabulary of ./list, evaluated in memory against the same facts. */
  const evalTerm = (term: WhereTerm, p: RuleProductFacts): boolean => {
    switch (term.kind) {
      case "brand_in":
        return p.brandId !== null && term.ids.includes(p.brandId);
      case "category_in":
        return term.ids.some((id) => p.categoryIds.includes(id));
      case "price_between":
        return p.price > 0 && (term.min === null || p.price >= term.min) && (term.max === null || p.price <= term.max);
      case "sale":
        return p.compareAtPrice !== null && p.price > 0 && p.compareAtPrice > p.price;
      case "avail":
        return p.available;
      // `ruleToPlan` may never emit any of these - a rule has no scope, no colour and no attribute.
      case "base":
      case "collection_in":
      case "new":
      case "gift_collections":
      case "ids":
      case "color_in":
      case "attr":
        throw new Error(`ruleToPlan emitted an unexpected term: ${term.kind}`);
    }
  };

  const rules: CollectionRule[] = [
    {},
    { brandIds: [24] },
    { brandIds: [24, 52] },
    { brandIds: [] },
    { categoryIds: [5] },
    { categoryIds: [] },
    { priceMin: 1 },
    { priceMax: 30_000_000 },
    { priceMin: 1, priceMax: 100_000_000 },
    { onSale: true },
    { inStock: true },
    { brandIds: [24], onSale: true, inStock: true, priceMin: 1 },
    { tags: [] },
  ];

  const samples: RuleProductFacts[] = [
    facts(),
    facts({ compareAtPrice: 48_000_000 }),
    facts({ brandId: null }),
    facts({ brandId: 52, categoryIds: [7] }),
    facts({ price: 0 }),
    facts({ price: 0, available: false }),
    facts({ available: false, compareAtPrice: 48_000_000 }),
    facts({ categoryIds: [] }),
  ];

  it("every rule × product pair agrees", () => {
    for (const rule of rules) {
      const plan = ruleToPlan(rule);
      for (const p of samples) {
        const viaPlan = plan.every((term) => evalTerm(term, p));
        expect({ rule, p, viaPlan }).toEqual({ rule, p, viaPlan: ruleMatches(rule, p) });
      }
    }
  });
});

// ── database ───────────────────────────────────────────────────────────────────────────────────

const AT = new Date("2026-08-26T12:00:00.000Z");
const DAY = 86_400_000;
const before = new Date(AT.getTime() - DAY);
const after = new Date(AT.getTime() + DAY);

const BASE = 830_000;
const GROUP_ID = BASE + 1;
const FUTURE_ID = BASE + 2;
const ENDED_ID = BASE + 3;
const DRAFT_ID = BASE + 4;
const ARCHIVED_ID = BASE + 5;
const SUB_ID = BASE + 6;
const EXACT_END_ID = BASE + 7;
const EXACT_START_ID = BASE + 8;
const FIXTURE_IDS = [GROUP_ID, FUTURE_ID, ENDED_ID, DRAFT_ID, ARCHIVED_ID, SUB_ID, EXACT_END_ID, EXACT_START_ID];

const ROOT_CATEGORY_ID = BASE + 21;
const CHILD_CATEGORY_ID = BASE + 22;
const BRAND_ID = BASE + 31;
const SALE_PRODUCT = BASE + 41;
const ARCHIVED_PRODUCT = BASE + 42;
const HIDDEN_PRODUCT = BASE + 43;
const ON_REQUEST_PRODUCT = BASE + 44;

const PREFIX = "collt";
const GROUP_SLUG = `${PREFIX}-coffee-and-drinks`;

const inputDefaults = {
  parentId: null,
  rule: null,
  productIds: null,
  coverMediaId: null,
  coverDarkMediaId: null,
  descriptionHtml: "",
  seoTitle: null,
  seoDescription: null,
  isNav: false,
  startsAt: null,
  endsAt: null,
  sort: 0,
};

/** Only the fixture collections - the test database is shared with the other suites. */
const mine = (rows: CollectionTile[]): number[] => rows.filter((c) => FIXTURE_IDS.includes(c.id)).map((c) => c.id);

describe.skipIf(!hasTestDb())("collections against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  async function seed(tx: Db): Promise<void> {
    await tx.insert(brandsTable).values({ id: BRAND_ID, slug: `${PREFIX}-smeg`, nameFa: "اسمگ", nameEn: "Smeg" });
    await tx.insert(categoriesTable).values([
      { id: ROOT_CATEGORY_ID, slug: `${PREFIX}-ریشه`, path: `${PREFIX}-ریشه`, name: "ریشه" },
      {
        id: CHILD_CATEGORY_ID,
        parentId: ROOT_CATEGORY_ID,
        slug: `${PREFIX}-شاخه`,
        path: `${PREFIX}-ریشه/${PREFIX}-شاخه`,
        name: "شاخه",
      },
    ]);
    await tx.insert(collectionsTable).values([
      { id: GROUP_ID, slug: GROUP_SLUG, name: "قهوه و نوشیدنی", kind: "group", status: "active", isNav: true, sort: 1 },
      { id: FUTURE_ID, slug: `${PREFIX}-future`, name: "آینده", kind: "campaign", status: "active", startsAt: after, sort: 2 },
      { id: ENDED_ID, slug: `${PREFIX}-ended`, name: "تمام‌شده", kind: "campaign", status: "active", endsAt: before, sort: 3 },
      { id: DRAFT_ID, slug: `${PREFIX}-draft`, name: "پیش‌نویس", kind: "campaign", status: "draft", sort: 4 },
      { id: ARCHIVED_ID, slug: `${PREFIX}-archived`, name: "بایگانی", kind: "campaign", status: "archived", sort: 5 },
      { id: SUB_ID, slug: `${PREFIX}-espresso`, name: "اسپرسو", kind: "sub", parentId: GROUP_ID, status: "active", sort: 6 },
      { id: EXACT_END_ID, slug: `${PREFIX}-exact-end`, name: "پایان دقیق", kind: "campaign", status: "active", endsAt: AT, sort: 7 },
      { id: EXACT_START_ID, slug: `${PREFIX}-exact-start`, name: "آغاز دقیق", kind: "gift", status: "active", startsAt: AT, sort: 8 },
    ]);
    await tx.insert(productsTable).values([
      { id: SALE_PRODUCT, slug: `${PREFIX}-p1`, name: "p1", displayName: "p1", brandId: BRAND_ID, status: "active", visibility: "public", price: 41_500_000, compareAtPrice: 48_000_000, stockQty: 2 },
      { id: ARCHIVED_PRODUCT, slug: `${PREFIX}-p2`, name: "p2", displayName: "p2", brandId: BRAND_ID, status: "archived", visibility: "public", price: 1_000, stockQty: 2 },
      { id: HIDDEN_PRODUCT, slug: `${PREFIX}-p3`, name: "p3", displayName: "p3", brandId: BRAND_ID, status: "active", visibility: "hidden", price: 1_000, stockQty: 2 },
      { id: ON_REQUEST_PRODUCT, slug: `${PREFIX}-p4`, name: "p4", displayName: "p4", brandId: BRAND_ID, status: "active", visibility: "public", price: 0, stockQty: 4 },
    ]);
    await tx.insert(productCategories).values([{ productId: SALE_PRODUCT, categoryId: CHILD_CATEGORY_ID, isPrimary: true }]);
    await tx.insert(collectionProductsTable).values([
      { collectionId: GROUP_ID, productId: ARCHIVED_PRODUCT, sort: 0 },
      { collectionId: GROUP_ID, productId: SALE_PRODUCT, sort: 1 },
      { collectionId: GROUP_ID, productId: HIDDEN_PRODUCT, sort: 2 },
    ]);
    // Explicit ids leave the serial sequence behind; push it past them so a row created by
    // `upsertCollection` with a default id cannot collide (the seed's `syncSequence` does the same).
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('collections', 'id'), (select coalesce(max(id), 1) from collections), true)`,
    );
  }

  it("live window table", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(mine(await listCollections(tx, { at: AT }))).toEqual([GROUP_ID, SUB_ID, EXACT_START_ID]);

      // filters compose with the window
      expect(mine(await listCollections(tx, { at: AT, navOnly: true }))).toEqual([GROUP_ID]);
      expect(mine(await listCollections(tx, { at: AT, kinds: ["gift"] }))).toEqual([EXACT_START_ID]);

      // both null → live; a past endsAt → not live; a future startsAt → not live
      expect((await getCollectionBySlug(tx, GROUP_SLUG, AT))?.seo.robots).toBe("index, follow");
      expect((await getCollectionBySlug(tx, `${PREFIX}-ended`, AT))?.seo.robots).toBe("noindex, follow");
      expect((await getCollectionBySlug(tx, `${PREFIX}-future`, AT))?.seo.robots).toBe("noindex, follow");
      // an ended campaign is SERVED (campaign links never die), it is only de-indexed
      expect(await getCollectionBySlug(tx, `${PREFIX}-ended`, AT)).not.toBeNull();
    });
  });

  it("half-open endsAt", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      // endsAt exactly `at` → NOT live
      expect(mine(await listCollections(tx, { at: AT }))).not.toContain(EXACT_END_ID);
      expect((await getCollectionBySlug(tx, `${PREFIX}-exact-end`, AT))?.seo.robots).toBe("noindex, follow");
      // one millisecond earlier it still is
      const justBefore = new Date(AT.getTime() - 1);
      expect(mine(await listCollections(tx, { at: justBefore }))).toContain(EXACT_END_ID);
      expect((await getCollectionBySlug(tx, `${PREFIX}-exact-end`, justBefore))?.seo.robots).toBe("index, follow");
      // startsAt exactly `at` → live
      expect(mine(await listCollections(tx, { at: AT }))).toContain(EXACT_START_ID);
    });
  });

  it("draft returns null", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(await getCollectionBySlug(tx, `${PREFIX}-draft`, AT)).toBeNull();
      expect(await getCollectionBySlug(tx, `${PREFIX}-archived`, AT)).toBeNull();
      expect(await getCollectionBySlug(tx, `${PREFIX}-nothing-here`, AT)).toBeNull();
      expect(await getCollectionBySlug(tx, "", AT)).toBeNull();
    });
  });

  it("archived manual member excluded", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      // the archived and the hidden member may never be listed, so neither is a member
      expect(await collectionProductIds(tx, GROUP_ID)).toEqual([SALE_PRODUCT]);
      const view = await getCollectionBySlug(tx, GROUP_SLUG, AT);
      expect(view?.count).toBe(1);
      expect(view?.children.map((c) => c.id)).toEqual([SUB_ID]);
      expect(view?.parentId).toBeNull();
      expect(view?.kind).toBe("group");
      expect(view?.seo.canonical).toBe(`/collection/${GROUP_SLUG}/`);
      expect(await collectionProductIds(tx, 999_999_999)).toEqual([]);
    });
  });

  it("rule members are unioned with the manual ones, manual first", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      // an ancestor rule reaches a product filed under the descendant category (SQL twin of the facts)
      await tx
        .update(collectionsTable)
        .set({ ruleJson: { categoryIds: [ROOT_CATEGORY_ID] } })
        .where(eq(collectionsTable.id, GROUP_ID));
      expect(await collectionProductIds(tx, GROUP_ID)).toEqual([SALE_PRODUCT]);

      await tx
        .update(collectionsTable)
        .set({ ruleJson: { brandIds: [BRAND_ID], inStock: true } })
        .where(eq(collectionsTable.id, GROUP_ID));
      // manual member first, then the rule matches by id desc - the on-request row IS in stock
      expect(await collectionProductIds(tx, GROUP_ID)).toEqual([SALE_PRODUCT, ON_REQUEST_PRODUCT]);
      expect((await getCollectionBySlug(tx, GROUP_SLUG, AT))?.count).toBe(2);
    });
  });

  it("previewRuleCount returns the live count and a sample", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(await previewRuleCount(tx, { brandIds: [BRAND_ID] })).toEqual({
        count: 2,
        sampleIds: [ON_REQUEST_PRODUCT, SALE_PRODUCT],
      });
      expect(await previewRuleCount(tx, { categoryIds: [ROOT_CATEGORY_ID] })).toEqual({
        count: 1,
        sampleIds: [SALE_PRODUCT],
      });
      expect(await previewRuleCount(tx, { brandIds: [BRAND_ID], onSale: true })).toEqual({
        count: 1,
        sampleIds: [SALE_PRODUCT],
      });
      expect(await previewRuleCount(tx, { brandIds: [BRAND_ID], priceMin: 1 })).toEqual({
        count: 1,
        sampleIds: [SALE_PRODUCT],
      });
      // an unknown / empty id set matches nothing, never everything
      expect(await previewRuleCount(tx, { brandIds: [] })).toEqual({ count: 0, sampleIds: [] });
      expect(await previewRuleCount(tx, { categoryIds: [999_999_999] })).toEqual({ count: 0, sampleIds: [] });
    });
  });

  it("upsert replaces membership, guards the slug and schedules the window flip", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      enqueue.mockClear();

      await expectAppError(
        upsertCollection(tx, { ...inputDefaults, slug: "قهوه", name: "بد", kind: "group", status: "active" }, ACTOR),
        "VALIDATION",
        "not_latin_slug",
      );
      await expectAppError(
        upsertCollection(tx, { ...inputDefaults, slug: "two words", name: "بد", kind: "group", status: "active" }, ACTOR),
        "VALIDATION",
        "not_latin_slug",
      );
      await expectAppError(
        upsertCollection(tx, { ...inputDefaults, slug: GROUP_SLUG, name: "تکراری", kind: "group", status: "active" }, ACTOR),
        "CONFLICT",
        "slug_taken",
      );
      await expectAppError(
        upsertCollection(
          tx,
          {
            ...inputDefaults,
            slug: `${PREFIX}-bad-window`,
            name: "پنجره",
            kind: "campaign",
            status: "active",
            startsAt: after.toISOString(),
            endsAt: before.toISOString(),
          },
          ACTOR,
        ),
        "VALIDATION",
        "window_inverted",
      );
      await expectAppError(
        upsertCollection(
          tx,
          { ...inputDefaults, slug: `${PREFIX}-tagged`, name: "برچسب", kind: "group", status: "active", rule: { tags: ["x"] } },
          ACTOR,
        ),
        "VALIDATION",
        "tags_not_supported",
      );

      const created = await upsertCollection(
        tx,
        {
          ...inputDefaults,
          slug: `${PREFIX}-gift-box`,
          name: "جعبه هدیه",
          kind: "gift",
          status: "active",
          productIds: [SALE_PRODUCT, ARCHIVED_PRODUCT],
          startsAt: before.toISOString(),
          endsAt: after.toISOString(),
          descriptionHtml: "<p>سلام</p><script>x()</script>",
        },
        ACTOR,
      );
      expect(created.tags).toEqual([`collection:${created.id}`, "nav", "catalog", "home", "sitemap"]);
      // rules: two cache.revalidate jobs, one per boundary, with a stable uniqueKey
      expect(enqueue).toHaveBeenCalledTimes(2);
      expect(enqueue.mock.calls.map((c) => (c as unknown[])[3])).toEqual([
        { uniqueKey: `collection:${created.id}:start`, runAt: before },
        { uniqueKey: `collection:${created.id}:end`, runAt: after },
      ]);

      const view = await getCollectionBySlug(tx, `${PREFIX}-gift-box`, AT);
      expect(view?.descriptionHtml).not.toContain("script");
      // the archived member is stored but never listed
      expect(await collectionProductIds(tx, created.id)).toEqual([SALE_PRODUCT]);

      // productIds null leaves membership untouched and no schedule change → no new job
      enqueue.mockClear();
      await upsertCollection(
        tx,
        {
          ...inputDefaults,
          id: created.id,
          slug: `${PREFIX}-gift-box`,
          name: "جعبه هدیه",
          kind: "gift",
          status: "active",
          startsAt: before.toISOString(),
          endsAt: after.toISOString(),
        },
        ACTOR,
      );
      expect(enqueue).not.toHaveBeenCalled();
      expect(await collectionProductIds(tx, created.id)).toEqual([SALE_PRODUCT]);
    });
  });

  it("upsert refuses a parent cycle and an unknown parent", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      await expectAppError(
        upsertCollection(
          tx,
          { ...inputDefaults, id: GROUP_ID, slug: GROUP_SLUG, name: "قهوه", kind: "group", status: "active", parentId: SUB_ID },
          ACTOR,
        ),
        "VALIDATION",
        "cycle",
      );
      await expectAppError(
        upsertCollection(
          tx,
          { ...inputDefaults, slug: `${PREFIX}-orphan`, name: "یتیم", kind: "sub", status: "active", parentId: 999_999_999 },
          ACTOR,
        ),
        "VALIDATION",
        "unknown_parent",
      );
    });
  });
});
