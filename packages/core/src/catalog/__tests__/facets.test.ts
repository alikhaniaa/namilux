import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  attributes,
  brands,
  collectionProducts,
  collections,
  productAttributeValues,
  products,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { type TestDb, createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";

import { AVAIL_FILTERS } from "../../constants";
import type { ProductScope } from "../list";
import * as repo from "../products.repo";
import type { FacetSources } from "../products.repo";
import {
  AVAIL_KEYS,
  type Facets,
  activeFilterChips,
  attributeValueKey,
  computeFacets,
  facetScopeKey,
  pruneFacets,
} from "../facets";

/** computeFacets never touches `db` on the "ids" branch, and the spy replaces it on the others. */
const db = {} as unknown as Db;

const facets = (over: Partial<Facets> = {}): Facets => ({
  brand: [],
  collection: [],
  color: [],
  price: { min: 0, max: 0 },
  avail: { in: 0, sale: 0, ready: 0 },
  attrs: [],
  total: 0,
  ...over,
});

describe("facetScopeKey", () => {
  it("facetScopeKey table", () => {
    const cases: [ProductScope, string][] = [
      [{ kind: "all" }, "all"],
      [{ kind: "category", id: 12 }, "category:12"],
      [{ kind: "brand", id: 24 }, "brand:24"],
      [{ kind: "collection", slug: "coffee" }, "collection:coffee"],
      [{ kind: "sale" }, "sale"],
      [{ kind: "new" }, "new"],
      [{ kind: "gifts" }, "gifts"],
      [{ kind: "ids", ids: [1, 2, 3] }, "ids"],
      // identifier fallbacks - a half-resolved scope never shares a key with a resolved one
      [{ kind: "category", slug: "توستر-اسمگ" }, "category:توستر-اسمگ"],
      [{ kind: "collection", id: 3 }, "collection:3"],
      [{ kind: "brand" }, "brand:"],
    ];
    for (const [scope, expected] of cases) {
      expect(facetScopeKey(scope)).toBe(expected);
    }
  });
});

describe("computeFacets", () => {
  it("ids scope has no facets", async () => {
    // EDGE CASE: compare/wishlist never show filters, and `total` is simply the number of ids.
    await expect(computeFacets(db, { kind: "ids", ids: [1, 2, 3] })).resolves.toEqual(
      facets({ total: 3 }),
    );
    await expect(computeFacets(db, { kind: "ids", ids: [] })).resolves.toEqual(facets({ total: 0 }));
    await expect(computeFacets(db, { kind: "ids" })).resolves.toEqual(facets({ total: 0 }));
  });

  it("price facet empty scope", async () => {
    // EDGE CASE: a scope with no priced products → price {0,0}, and pruning never invents a range.
    const empty = await computeFacets(db, { kind: "ids", ids: [] });
    expect(empty.price).toEqual({ min: 0, max: 0 });
    expect(pruneFacets(empty, {}).price).toEqual({ min: 0, max: 0 });

    const priced = facets({ price: { min: 300_000, max: 41_500_000 }, total: 172 });
    expect(pruneFacets(priced, { brand: ["smeg"] }).price).toEqual({ min: 300_000, max: 41_500_000 });
  });

  it("returns a fresh object each call", async () => {
    const a = await computeFacets(db, { kind: "ids", ids: [1] });
    const b = await computeFacets(db, { kind: "ids", ids: [2] });
    expect(a).not.toBe(b);
    expect(a.brand).not.toBe(b.brand);
  });

  describe("assembly over queryFacetSources", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const sources = (over: Partial<FacetSources> = {}): FacetSources => ({
      total: 0,
      price: { min: 0, max: 0 },
      avail: { in: 0, sale: 0, ready: 0 },
      brands: [],
      collections: [],
      attributes: [],
      ...over,
    });

    const spy = (src: FacetSources): void => {
      vi.spyOn(repo, "queryFacetSources").mockResolvedValue(src);
    };

    it("splits the colour attribute out and groups the rest by key", async () => {
      spy(
        sources({
          total: 172,
          price: { min: 300_000, max: 41_500_000 },
          avail: { in: 90, sale: 12, ready: 84 },
          brands: [
            { id: 24, slug: "smeg", name: "اسمگ", count: 61 },
            { id: 52, slug: "dyson", name: "دایسون", count: 7 },
          ],
          collections: [
            { id: 3, slug: "coffee", name: "قهوه و نوشیدنی", kind: "group", sort: 1, count: 40 },
          ],
          // exactly the order the repo returns: by attributes.sort, colour included
          attributes: [
            {
              key: "color",
              label: "رنگ",
              unit: null,
              kind: "color",
              sort: 1,
              value: "مشکی",
              valueLabel: "مشکی",
              count: 9,
              hex: "101010",
              swatch: null,
            },
            {
              key: "color",
              label: "رنگ",
              unit: null,
              kind: "color",
              sort: 1,
              value: "کرم",
              valueLabel: "کرم",
              count: 4,
              hex: null,
              swatch: null,
            },
            {
              key: "power",
              label: "توان",
              unit: "W",
              kind: "number",
              sort: 2,
              value: "1200",
              valueLabel: "1200",
              count: 5,
              hex: null,
              swatch: null,
            },
            {
              key: "power",
              label: "توان",
              unit: "W",
              kind: "number",
              sort: 2,
              value: "1500",
              valueLabel: "1500",
              count: 3,
              hex: null,
              swatch: null,
            },
            {
              key: "material",
              label: "جنس",
              unit: null,
              kind: "text",
              sort: 3,
              value: "steel",
              valueLabel: "استیل",
              count: 2,
              hex: null,
              swatch: null,
            },
          ],
        }),
      );

      const f = await computeFacets(db, { kind: "all" });

      expect(f.total).toBe(172);
      expect(f.price).toEqual({ min: 300_000, max: 41_500_000 });
      expect(f.avail).toEqual({ in: 90, sale: 12, ready: 84 });
      // brands/collections are addressed by slug and read by name
      expect(f.brand).toEqual([
        { value: "smeg", label: "اسمگ", count: 61 },
        { value: "dyson", label: "دایسون", count: 7 },
      ]);
      expect(f.collection).toEqual([{ value: "coffee", label: "قهوه و نوشیدنی", count: 40 }]);
      // "color" becomes its own group, never an AttributeFacet
      expect(f.color).toEqual([
        { value: "مشکی", label: "مشکی", count: 9, hex: "101010" },
        { value: "کرم", label: "کرم", count: 4 },
      ]);
      // a null hex/swatch is omitted, not written as null (tsconfig exactOptionalPropertyTypes)
      expect(Object.hasOwn(f.color[1] ?? {}, "hex")).toBe(false);
      expect(Object.hasOwn(f.color[1] ?? {}, "swatch")).toBe(false);
      // the remaining keys keep attributes.sort order and carry unit + kind
      expect(f.attrs.map((a) => a.key)).toEqual(["power", "material"]);
      expect(f.attrs[0]).toEqual({
        key: "power",
        label: "توان",
        unit: "W",
        kind: "number",
        options: [
          { value: "1200", label: "1200", count: 5 },
          { value: "1500", label: "1500", count: 3 },
        ],
      });
      expect(f.attrs[1]?.unit).toBeNull();
      expect(f.attrs[1]?.kind).toBe("text");
    });

    it("passes the scope through and copies the value objects", async () => {
      const src = sources({
        total: 3,
        price: { min: 1, max: 2 },
        avail: { in: 1, sale: 0, ready: 1 },
      });
      spy(src);
      const scope: ProductScope = { kind: "category", id: 12 };
      const f = await computeFacets(db, scope);
      expect(repo.queryFacetSources).toHaveBeenCalledWith(db, scope);
      // price/avail are copied, so a cached Facets can never be mutated through the repo result
      expect(f.price).not.toBe(src.price);
      expect(f.avail).not.toBe(src.avail);
      expect(f.price).toEqual({ min: 1, max: 2 });
    });

    it("a scope with no rows yields empty groups", async () => {
      spy(sources({ total: 0 }));
      expect(await computeFacets(db, { kind: "gifts" })).toEqual(facets({ total: 0 }));
    });

    it("the ids short-circuit never queries", async () => {
      spy(sources({ total: 999 }));
      expect(await computeFacets(db, { kind: "ids", ids: [1, 2] })).toEqual(facets({ total: 2 }));
      expect(repo.queryFacetSources).not.toHaveBeenCalled();
    });
  });
});

describe("pruneFacets", () => {
  const source = (): Facets =>
    facets({
      total: 41,
      brand: [
        { value: "smeg", label: "اسمگ", count: 3 },
        { value: "dyson", label: "دایسون", count: 0 },
        { value: "sage", label: "سیج", count: 0 },
      ],
      collection: [{ value: "coffee", label: "قهوه و نوشیدنی", count: 0 }],
      color: [
        { value: "مشکی", label: "مشکی", count: 0 },
        { value: "کرم", label: "کرم", count: 4 },
      ],
      attrs: [
        {
          key: "wattage",
          label: "توان",
          unit: "W",
          kind: "number",
          options: [{ value: "1500", label: "1500", count: 0 }],
        },
        {
          key: "material",
          label: "جنس",
          unit: null,
          kind: "text",
          options: [
            { value: "steel", label: "استیل", count: 2 },
            { value: "plastic", label: "پلاستیک", count: 0 },
          ],
        },
      ],
    });

  it("prune keeps selected zero-count", () => {
    // EDGE CASE: a stale URL token with count 0 survives so its chip stays removable.
    const f = source();
    const pruned = pruneFacets(f, {
      brand: ["dyson"],
      color: ["مشکی"],
      attr: { material: ["plastic"] },
    });

    expect(pruned.brand.map((o) => o.value)).toEqual(["smeg", "dyson"]);
    expect(pruned.collection).toEqual([]);
    expect(pruned.color.map((o) => o.value)).toEqual(["مشکی", "کرم"]);
    expect(pruned.attrs.map((a) => a.key)).toEqual(["material"]);
    expect(pruned.attrs[0]?.options.map((o) => o.value)).toEqual(["steel", "plastic"]);
    // the scope size is not affected by pruning the option lists
    expect(pruned.total).toBe(41);

    // pure: the input is untouched
    expect(f).toEqual(source());
    expect(pruned.price).not.toBe(f.price);
  });

  it("drops every count-0 option (and the facet it empties) when nothing is selected", () => {
    const pruned = pruneFacets(source(), {});
    expect(pruned.brand.map((o) => o.value)).toEqual(["smeg"]);
    expect(pruned.collection).toEqual([]);
    expect(pruned.color.map((o) => o.value)).toEqual(["کرم"]);
    expect(pruned.attrs.map((a) => a.key)).toEqual(["material"]);
    expect(pruned.attrs[0]?.options.map((o) => o.value)).toEqual(["steel"]);
  });

  it("keeps the colour swatch payload of an option it keeps", () => {
    const swatch = {
      key: "p/1044/1/a8f3.jpg",
      alt: "مشکی",
      width: 64,
      height: 64,
    } as unknown as NonNullable<Facets["color"][number]["swatch"]>;
    const pruned = pruneFacets(
      facets({ color: [{ value: "مشکی", label: "مشکی", count: 2, hex: "111111", swatch }] }),
      {},
    );
    expect(pruned.color[0]?.hex).toBe("111111");
    expect(pruned.color[0]?.swatch).toBe(swatch);
  });
});

describe("activeFilterChips", () => {
  const full = (): Facets =>
    facets({
      total: 12,
      brand: [
        { value: "smeg", label: "اسمگ", count: 2 },
        { value: "dyson", label: "دایسون", count: 1 },
      ],
      collection: [{ value: "coffee", label: "قهوه و نوشیدنی", count: 2 }],
      color: [{ value: "مشکی", label: "مشکی", count: 3 }],
      attrs: [
        {
          key: "material",
          label: "جنس",
          unit: null,
          kind: "text",
          options: [{ value: "steel", label: "استیل", count: 2 }],
        },
      ],
    });

  it("emits one chip per token, in URL order", () => {
    const chips = activeFilterChips(
      {
        brand: ["smeg"],
        collection: ["coffee"],
        color: ["مشکی"],
        priceMin: 1_000_000,
        priceMax: 5_000_000,
        avail: ["ready", "in"],
        attr: { material: ["steel"] },
        sort: "newest",
        page: 2,
        density: 5,
      },
      full(),
    );

    expect(chips.map((c) => c.group)).toEqual([
      "brand",
      "collection",
      "color",
      "price",
      "avail",
      "avail",
      "attr",
    ]);
    expect(chips.map((c) => c.value)).toEqual([
      "smeg",
      "coffee",
      "مشکی",
      "1000000-5000000",
      "in",
      "ready",
      "steel",
    ]);
    // labels: brand/collection/colour from the facet, price left to the UI, avail = i18n keys
    expect(chips.map((c) => c.label)).toEqual([
      "اسمگ",
      "قهوه و نوشیدنی",
      "مشکی",
      "",
      "plp.avail.in",
      "plp.avail.ready",
      "جنس: استیل",
    ]);
    expect(chips[6]?.key).toBe("material");
    expect(chips[0]?.key).toBeUndefined();

    // removing the price chip drops both bounds and `page`, and keeps sort/density
    const removed = chips[3]?.removeState;
    expect(removed?.priceMin).toBeUndefined();
    expect(removed?.priceMax).toBeUndefined();
    expect(removed?.page).toBeUndefined();
    expect(removed?.sort).toBe("newest");
    expect(removed?.density).toBe(5);
  });

  it("chips ignore unknown attr", () => {
    // EDGE CASE: `bogus` is a syntactically valid attr key that is not filterable → no chip, no throw.
    const chips = activeFilterChips({ attr: { material: ["steel"], bogus: ["x"] } }, full());
    expect(chips).toHaveLength(1);
    expect(chips[0]?.value).toBe("steel");
    // the unknown key stays in the state - it has no chip, so nothing can remove it
    expect(chips[0]?.removeState).toEqual({ attr: { bogus: ["x"] } });
  });

  it("chip for unknown colour token", () => {
    // EDGE CASE: a token the facets do not know is still shown (raw label) and still removable.
    const chips = activeFilterChips({ color: ["طلایی"] }, full());
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe("طلایی");
    expect(chips[0]?.removeState).toEqual({});
  });

  it("removeState drops empty group and page", () => {
    const last = activeFilterChips({ brand: ["smeg"], page: 3 }, full());
    expect(last[0]?.removeState).toEqual({});

    // two tokens: the other one survives, `page` still resets
    const two = activeFilterChips({ brand: ["dyson", "smeg"], page: 4 }, full());
    expect(two.map((c) => c.value)).toEqual(["dyson", "smeg"]);
    expect(two[0]?.removeState).toEqual({ brand: ["smeg"] });
    expect(two[1]?.removeState).toEqual({ brand: ["dyson"] });

    // last attribute value: the key disappears, not an empty array
    const attr = activeFilterChips({ attr: { material: ["steel"] }, page: 2 }, full());
    expect(attr[0]?.removeState).toEqual({});
  });

  it("returns no chips for sort / page / density alone", () => {
    expect(activeFilterChips({ sort: "price_asc", page: 3, density: 5 }, full())).toEqual([]);
  });
});

describe("attributeValueKey", () => {
  it("attributeValueKey table", () => {
    const cases: [Parameters<typeof attributeValueKey>, string][] = [
      [["text", "  کِرِم ", null], "کرم"],
      [["text", "  Stainless   STEEL ", null], "stainless steel"],
      [["text", null, null], ""],
      [["color", "مشکي", null], "مشکی"],
      [["color", "ویژگی‌ها", null], "ویژگی ها"],
      [["number", null, 1.5], "1.5"],
      [["number", null, 1500], "1500"],
      [["number", null, 0], "0"],
      [["number", null, null], ""],
      [["number", null, Number.NaN], ""],
      [["number", null, Number.POSITIVE_INFINITY], ""],
      [["bool", null, 1], "1"],
      [["bool", null, 0], "0"],
      [["bool", "TRUE", null], "1"],
      [["bool", " yes ", null], "1"],
      [["bool", "no", null], "0"],
      [["bool", null, null], "0"],
    ];
    for (const [args, expected] of cases) {
      expect(attributeValueKey(...args)).toBe(expected);
    }
  });
});

describe("AVAIL_KEYS", () => {
  it("mirrors the AVAIL_FILTERS enum of ../constants", () => {
    expect([...AVAIL_KEYS]).toEqual([...AVAIL_FILTERS]);
  });
});

// ── the real aggregation ───────────────────────────────────────────────────────────────────────
// Needs Postgres; skipped when DATABASE_URL_TEST is absent. Every row is inserted inside a
// transaction that is always rolled back, and every assertion is scoped to the fixture, so this can
// never race another suite that shares the test database.
const PREFIX = "facets-test";

describe.skipIf(!hasTestDb())("computeFacets against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  async function seed(tx: DbTx): Promise<{ brandId: number; collectionId: number }> {
    const [brand] = await tx
      .insert(brands)
      .values({ slug: `${PREFIX}-brand`, nameFa: "برند پالایش", nameEn: "Facets Brand" })
      .returning({ id: brands.id });
    const brandId = brand?.id ?? 0;

    const [collection] = await tx
      .insert(collections)
      .values({
        slug: `${PREFIX}-group`,
        name: "گروه پالایش",
        kind: "group",
        status: "active",
        sort: 1,
      })
      .returning({ id: collections.id });
    const collectionId = collection?.id ?? 0;

    const [colorAttr] = await tx
      .insert(attributes)
      .values({ key: "color", label: "رنگ", kind: "color", isFilterable: true, sort: 1 })
      .onConflictDoUpdate({
        target: attributes.key,
        set: { isFilterable: true, kind: "color", sort: 1 },
      })
      .returning({ id: attributes.id });
    const [powerAttr] = await tx
      .insert(attributes)
      .values({
        key: `${PREFIX}_power`,
        label: "توان",
        unit: "W",
        kind: "number",
        isFilterable: true,
        sort: 2,
      })
      .onConflictDoUpdate({ target: attributes.key, set: { isFilterable: true, sort: 2 } })
      .returning({ id: attributes.id });

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
          stockPolicy: "untracked",
        },
        {
          slug: `${PREFIX}-plain`,
          name: "کالای ساده",
          displayName: "کالای ساده",
          brandId,
          status: "active",
          visibility: "public",
          price: 3_000_000,
          stockPolicy: "track",
          stockQty: 4,
        },
        {
          // a draft row must never be counted (rules: status=active AND visibility=public)
          slug: `${PREFIX}-draft`,
          name: "پیش‌نویس",
          displayName: "پیش‌نویس",
          brandId,
          status: "draft",
          visibility: "public",
          price: 90_000_000,
          stockPolicy: "untracked",
        },
      ])
      .returning({ id: products.id, slug: products.slug });
    const idOf = (slug: string): number => rows.find((r) => r.slug === slug)?.id ?? 0;

    await tx.insert(collectionProducts).values([
      { collectionId, productId: idOf(`${PREFIX}-sale`), sort: 0 },
      { collectionId, productId: idOf(`${PREFIX}-plain`), sort: 1 },
    ]);
    await tx.insert(productAttributeValues).values([
      { productId: idOf(`${PREFIX}-sale`), attributeId: colorAttr?.id ?? 0, valueText: " مشکی " },
      { productId: idOf(`${PREFIX}-plain`), attributeId: colorAttr?.id ?? 0, valueText: "مشکی" },
      { productId: idOf(`${PREFIX}-sale`), attributeId: powerAttr?.id ?? 0, valueNum: "1200" },
      // the draft row carries a value that must not surface in any facet
      { productId: idOf(`${PREFIX}-draft`), attributeId: powerAttr?.id ?? 0, valueNum: "9900" },
    ]);

    return { brandId, collectionId };
  }

  it("aggregates a brand scope into the CONTRACT shape", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { brandId } = await seed(tx);
      const f = await computeFacets(tx, { kind: "brand", id: brandId });

      // two active+public rows; the draft one is invisible everywhere
      expect(f.total).toBe(2);
      expect(f.price).toEqual({ min: 1_000_000, max: 3_000_000 });
      expect(f.avail).toEqual({ in: 2, sale: 1, ready: 2 });

      expect(f.brand).toEqual([{ value: `${PREFIX}-brand`, label: "برند پالایش", count: 2 }]);
      expect(f.collection).toEqual([{ value: `${PREFIX}-group`, label: "گروه پالایش", count: 2 }]);

      // colour is its own group, keyed by the faNorm'd token (the " مشکی " row folds into it)
      expect(f.color.map((o) => [o.value, o.count])).toEqual([
        [attributeValueKey("color", " مشکی ", null), 2],
      ]);
      expect(f.attrs.map((a) => a.key)).toEqual([`${PREFIX}_power`]);
      expect(f.attrs[0]?.unit).toBe("W");
      expect(f.attrs[0]?.kind).toBe("number");
      expect(f.attrs[0]?.options).toEqual([
        { value: attributeValueKey("number", null, 1200), label: "1200", count: 1 },
      ]);
    });
  }, 30_000);

  it("a scope with nothing in it is the empty facets object", async () => {
    await withTestTx(handle.db, async (tx) => {
      // EDGE CASE: no priced products in scope → price {0,0}
      expect(await computeFacets(tx, { kind: "brand", id: -1 })).toEqual(facets({ total: 0 }));
    });
  }, 30_000);
});
