import { describe, expect, it, vi } from "vitest";
import { brands, eq, inArray, productModels, products } from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { afterAll, beforeAll } from "vitest";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import {
  COLOUR_TOKENS,
  DISPLAY_NAME_COLOUR_SEPARATOR,
  groupModels,
  modelKey,
  pickPrimaryVariant,
  planGroups,
  setModel,
  splitDisplayName,
  stripColourTokens,
} from "../models";
import type { GroupCandidate } from "../models";
import type { Actor } from "../../types";
import { faNorm } from "../../persian";

const ACTOR: Actor = { type: "staff", id: "0000000000000000000STAFF01" };

const candidate = (over: Partial<GroupCandidate> & { id: number }): GroupCandidate => ({
  brandId: 1,
  key: "k",
  available: true,
  priced: true,
  hasImage: true,
  displayName: "کالا",
  ...over,
});

describe("catalog/models (pure)", () => {
  it("separator split", () => {
    expect(splitDisplayName("کتری برقی ساده اسمگ KLF03 · مشکی")).toEqual({
      base: "کتری برقی ساده اسمگ KLF03",
      colour: "مشکی",
    });
    // the LAST separator wins - an earlier one belongs to the model name
    expect(splitDisplayName("سری A · B · سفید")).toEqual({ base: "سری A · B", colour: "سفید" });
    expect(splitDisplayName("بدون رنگ")).toEqual({ base: "بدون رنگ", colour: null });
    // a trailing separator with nothing after it is not a colour
    expect(splitDisplayName(`مدل${DISPLAY_NAME_COLOUR_SEPARATOR}`)).toEqual({
      base: "مدل",
      colour: null,
    });
  });

  it("colour tokens stripped", () => {
    const withSeparator = modelKey({
      name: "کتری",
      displayName: "کتری برقی ساده اسمگ KLF03 · مشکی",
      sku: null,
      modelCode: "KLF03",
    });
    const withoutSeparator = modelKey({
      name: "کتری",
      displayName: "کتری برقی ساده اسمگ KLF03 مشکی",
      sku: null,
      modelCode: "KLF03",
    });
    expect(withSeparator).toBe("کتری برقی ساده اسمگ klf03");
    expect(withoutSeparator).toBe(withSeparator);
    expect(stripColourTokens(faNorm("کتری سفید"))).toBe("کتری");
    // every DECIDED token is removable
    for (const token of COLOUR_TOKENS) expect(stripColourTokens(faNorm(`کالا ${token}`))).toBe("کالا");
  });

  it("zwnj-insensitive tokens", () => {
    const zwnj = modelKey({ name: "x", displayName: "جاروبرقی V15 نقره‌ای", sku: null, modelCode: null });
    const plain = modelKey({ name: "x", displayName: "جاروبرقی V15 نقرهای", sku: null, modelCode: null });
    expect(zwnj).toBe(plain);
    expect(zwnj).toBe("جاروبرقی v15");
  });

  it("latin model codes distinguish keys", () => {
    const k3 = modelKey({ name: "x", displayName: "کتری اسمگ KLF03 · مشکی", sku: null, modelCode: null });
    const k4 = modelKey({ name: "x", displayName: "کتری اسمگ KLF04 · مشکی", sku: null, modelCode: null });
    expect(k3).not.toBe(k4);
    // faNorm lower-cases Latin and folds Persian digits, so KLF۰۳ and KLF03 are one key
    expect(modelKey({ name: "x", displayName: "کتری اسمگ KLF۰۳ · سفید", sku: null, modelCode: null })).toBe(k3);
  });

  it("colour-only name not grouped", () => {
    const key = modelKey({ name: "مشکی سفید", displayName: null, sku: null, modelCode: null });
    expect(key).toBe("");
    const plans = planGroups([
      candidate({ id: 1, key: "" }),
      candidate({ id: 2, key: "" }),
    ]);
    expect(plans).toEqual([]);
    // an empty display_name falls back to `name` instead of producing the "never group" key
    expect(modelKey({ name: "کتری اسمگ", displayName: "   ", sku: null, modelCode: null })).toBe("کتری اسمگ");
  });

  it("brand boundary", () => {
    const plans = planGroups([
      candidate({ id: 1, brandId: 24, key: "کتری klf03" }),
      candidate({ id: 2, brandId: 24, key: "کتری klf03" }),
      candidate({ id: 3, brandId: 52, key: "کتری klf03" }),
      candidate({ id: 4, brandId: null, key: "کتری klf03" }),
      candidate({ id: 5, brandId: null, key: "کتری klf03" }),
    ]);
    // brand 24 groups (2 members); brand 52 has one member; the two brandless rows are their own group
    expect(plans.map((p) => p.brandId).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([null, 24]);
    expect(plans.find((p) => p.brandId === 24)?.productIds).toEqual([1, 2]);
    expect(plans.find((p) => p.brandId === null)?.productIds).toEqual([4, 5]);
  });

  it("primary variant pick order", () => {
    // EDGE CASE: [out+image, in-stock+priced+no-image, in-stock+priced+image] → the last one
    const members = [
      candidate({ id: 10, available: false, priced: true, hasImage: true }),
      candidate({ id: 11, available: true, priced: true, hasImage: false }),
      candidate({ id: 12, available: true, priced: true, hasImage: true }),
    ];
    expect(pickPrimaryVariant(members)).toBe(12);
    // available && !priced beats an unavailable imaged row; ties break on the lowest id
    expect(
      pickPrimaryVariant([
        candidate({ id: 21, available: false, priced: true, hasImage: true }),
        candidate({ id: 22, available: true, priced: false, hasImage: false }),
      ]),
    ).toBe(22);
    expect(
      pickPrimaryVariant([candidate({ id: 31 }), candidate({ id: 30 })]),
    ).toBe(30);
    // nothing available or imaged → lowest id
    expect(
      pickPrimaryVariant([
        candidate({ id: 41, available: false, priced: false, hasImage: false }),
        candidate({ id: 40, available: false, priced: false, hasImage: false }),
      ]),
    ).toBe(40);
  });

  it("plan display name drops the colour", () => {
    const plans = planGroups([
      candidate({ id: 1, key: "کتری اسمگ klf03", displayName: "کتری اسمگ KLF03 · مشکی" }),
      candidate({ id: 2, key: "کتری اسمگ klf03", displayName: "کتری اسمگ KLF03 · سفید", hasImage: false }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.displayName).toBe("کتری اسمگ KLF03");
    expect(plans[0]?.primaryProductId).toBe(1);
  });
});

const PREFIX = "models-test";

/** modelKey() of the two MTX01 variants below. */
const MODEL_KEY = "کتری برقی ساده اسمگ mtx01";

type Fixture = { brandId: number; blackId: number; whiteId: number; loneId: number; manualId: number };

async function seedFixture(tx: Db): Promise<Fixture> {
  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند مدل", nameEn: "Models Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-black`,
        name: "کتری برقی ساده اسمگ MTX01",
        displayName: "کتری برقی ساده اسمگ MTX01 · مشکی",
        brandId,
        status: "active",
        visibility: "public",
        price: 1_000_000,
        stockPolicy: "track",
        stockQty: 2,
      },
      {
        slug: `${PREFIX}-white`,
        name: "کتری برقی ساده اسمگ MTX01",
        displayName: "کتری برقی ساده اسمگ MTX01 سفید",
        brandId,
        status: "active",
        visibility: "public",
        price: 1_100_000,
        stockPolicy: "track",
        stockQty: 0,
      },
      {
        slug: `${PREFIX}-lone`,
        name: "توستر اسمگ MTX02",
        displayName: "توستر اسمگ MTX02",
        brandId,
        status: "active",
        visibility: "public",
        price: 900_000,
        stockPolicy: "untracked",
      },
      {
        slug: `${PREFIX}-manual`,
        name: "همزن اسمگ MTX03",
        displayName: "همزن اسمگ MTX03 · قرمز",
        brandId,
        status: "active",
        visibility: "public",
        price: 800_000,
        stockPolicy: "untracked",
      },
    ])
    .returning({ id: products.id, slug: products.slug });

  const idOf = (slug: string): number => rows.find((r) => r.slug === slug)?.id ?? 0;
  return {
    brandId,
    blackId: idOf(`${PREFIX}-black`),
    whiteId: idOf(`${PREFIX}-white`),
    loneId: idOf(`${PREFIX}-lone`),
    manualId: idOf(`${PREFIX}-manual`),
  };
}

describe.skipIf(!hasTestDb())("catalog/models against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("manual groups untouched", async () => {
    await run(async (tx, f) => {
      const [manualModel] = await tx
        .insert(productModels)
        .values({
          key: `manual:${PREFIX}`,
          displayName: "گروه دستی",
          brandId: f.brandId,
          primaryProductId: f.manualId,
        })
        .returning({ id: productModels.id });
      const manualModelId = manualModel?.id ?? 0;
      await tx.update(products).set({ modelId: manualModelId }).where(eq(products.id, f.manualId));

      await groupModels(tx, ACTOR);

      const after = await tx
        .select({ id: products.id, modelId: products.modelId })
        .from(products)
        .where(inArray(products.id, [f.blackId, f.whiteId, f.loneId, f.manualId]));
      const modelOf = (id: number): number | null =>
        after.find((r) => r.id === id)?.modelId ?? null;

      // the manual member keeps its manual model, and the row itself survives
      expect(modelOf(f.manualId)).toBe(manualModelId);
      const stillThere = await tx
        .select({ id: productModels.id })
        .from(productModels)
        .where(eq(productModels.id, manualModelId));
      expect(stillThere).toHaveLength(1);

      // the two colour variants were grouped; the single-member key stays NULL
      const black = modelOf(f.blackId);
      expect(black).not.toBeNull();
      expect(modelOf(f.whiteId)).toBe(black);
      expect(modelOf(f.loneId)).toBeNull();

      // and the group points at the in-stock variant with the brand-scoped key
      const group = (
        await tx
          .select({
            key: productModels.key,
            displayName: productModels.displayName,
            brandId: productModels.brandId,
            primaryProductId: productModels.primaryProductId,
          })
          .from(productModels)
          .where(eq(productModels.id, black ?? 0))
      )[0];
      expect(group?.primaryProductId).toBe(f.blackId);
      expect(group?.brandId).toBe(f.brandId);
      expect(group?.displayName).toBe("کتری برقی ساده اسمگ MTX01");
      // the spec: the stored key is the bare model key (faNorm of the name minus the colour tokens)
      expect(group?.key).toBe("کتری برقی ساده اسمگ mtx01");
    });
  }, 60_000);

  it("idempotent rerun", async () => {
    await run(async (tx, f) => {
      const first = await groupModels(tx, ACTOR);
      expect(first.assigned).toBeGreaterThanOrEqual(2);

      const second = await groupModels(tx, ACTOR);
      // EDGE CASE: rerun with no changes → { groups: n, assigned: 0 }
      expect(second.groups).toBe(first.groups);
      expect(second.assigned).toBe(0);

      // 02 SS2: the stored key is the bare model key, so the rerun reuses the same row
      const models = await tx
        .select({ id: productModels.id })
        .from(productModels)
        .where(eq(productModels.key, MODEL_KEY));
      expect(models).toHaveLength(1);
      expect(f.brandId).toBeGreaterThan(0);
    });
  }, 60_000);

  it("setModel assigns and validates", async () => {
    await run(async (tx, f) => {
      await groupModels(tx, ACTOR);
      const modelId = (
        await tx
          .select({ modelId: products.modelId })
          .from(products)
          .where(eq(products.id, f.blackId))
      )[0]?.modelId;
      expect(modelId).not.toBeNull();

      await setModel(tx, f.loneId, modelId ?? null, ACTOR);
      const after = (
        await tx.select({ modelId: products.modelId }).from(products).where(eq(products.id, f.loneId))
      )[0];
      expect(after?.modelId).toBe(modelId);

      await setModel(tx, f.loneId, null, ACTOR);
      const cleared = (
        await tx.select({ modelId: products.modelId }).from(products).where(eq(products.id, f.loneId))
      )[0];
      expect(cleared?.modelId).toBeNull();

      await expect(setModel(tx, 987_654_321, null, ACTOR)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(setModel(tx, f.loneId, 987_654_321, ACTOR)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  }, 60_000);
});
