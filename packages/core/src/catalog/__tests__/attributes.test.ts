import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  attributes as attributesTable,
  brands,
  eq,
  productAttributeValues,
  productSpecs,
  products,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
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

import {
  ATTRIBUTE_KEY_RE,
  COLOR_ATTRIBUTE_KEY,
  COMPARE_MAX,
  compareRows,
  formatAttributeValue,
  listAttributes,
  setProductAttributeValues,
  upsertAttribute,
  valuesForProduct,
} from "../attributes";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "0000000000000000000STAFF01" };

async function expectAppError(p: Promise<unknown>, code: ErrorCode): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (err: unknown) {
    caught = err;
  }
  expect(isAppError(caught) ? caught.code : caught).toBe(code);
}

describe("catalog/attributes (pure)", () => {
  it("key regex", () => {
    expect(ATTRIBUTE_KEY_RE.test(COLOR_ATTRIBUTE_KEY)).toBe(true);
    expect(ATTRIBUTE_KEY_RE.test("attrtest_power")).toBe(true);
    expect(ATTRIBUTE_KEY_RE.test("capacity2")).toBe(true);
    // EDGE CASE: "Color" or the Persian label are not keys
    expect(ATTRIBUTE_KEY_RE.test("Color")).toBe(false);
    expect(ATTRIBUTE_KEY_RE.test("رنگ")).toBe(false);
    expect(ATTRIBUTE_KEY_RE.test("a")).toBe(false);
    expect(ATTRIBUTE_KEY_RE.test("2color")).toBe(false);
    expect(ATTRIBUTE_KEY_RE.test("color-name")).toBe(false);
  });

  it("format table (number/unit/bool/text)", () => {
    const table: { in: Parameters<typeof formatAttributeValue>[0]; out: string }[] = [
      // EDGE CASE: 1.5 with unit "L" → decimal separator U+066B
      { in: { kind: "number", valueText: null, valueNum: 1.5, unit: "L" }, out: "۱٫۵ L" },
      { in: { kind: "number", valueText: null, valueNum: 1200, unit: "W" }, out: "۱٬۲۰۰ W" },
      { in: { kind: "number", valueText: null, valueNum: 7, unit: null }, out: "۷" },
      { in: { kind: "number", valueText: null, valueNum: -2.5, unit: null }, out: "−۲٫۵" },
      { in: { kind: "number", valueText: null, valueNum: null, unit: "W" }, out: "" },
      // EDGE CASE: bool 1 → «دارد»
      { in: { kind: "bool", valueText: null, valueNum: 1, unit: "W" }, out: "دارد" },
      { in: { kind: "bool", valueText: null, valueNum: 0, unit: null }, out: "ندارد" },
      // a legacy row that stored the flag as text still reads as a word
      { in: { kind: "bool", valueText: "yes", valueNum: null, unit: null }, out: "دارد" },
      { in: { kind: "bool", valueText: null, valueNum: null, unit: null }, out: "" },
      { in: { kind: "text", valueText: " فولاد ", valueNum: null, unit: null }, out: "فولاد" },
      // the spec: Latin digits survive inside a Latin designator, Persian digits elsewhere
      { in: { kind: "text", valueText: "KLF04", valueNum: null, unit: null }, out: "KLF04" },
      { in: { kind: "text", valueText: "ظرفیت 3", valueNum: null, unit: "لیتر" }, out: "ظرفیت ۳ لیتر" },
      { in: { kind: "color", valueText: "مشکی", valueNum: null, unit: null }, out: "مشکی" },
      { in: { kind: "color", valueText: "", valueNum: null, unit: null }, out: "" },
    ];
    for (const row of table) expect(formatAttributeValue(row.in)).toBe(row.out);
  });
});

const PREFIX = "attr-test";
const K_POWER = "attrtest_power";
const K_FLAG = "attrtest_flag";
const K_BODY = "attrtest_body";
const K_QUIET = "attrtest_quiet";

type Fixture = {
  brandId: number;
  powerId: number;
  flagId: number;
  bodyId: number;
  quietId: number;
  aId: number;
  bId: number;
  cId: number;
  dId: number;
  archivedId: number;
};

async function seedFixture(tx: Db): Promise<Fixture> {
  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند مشخصات", nameEn: "Attr Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const attrRows = await tx
    .insert(attributesTable)
    .values([
      { key: K_POWER, label: "توان", unit: "W", kind: "number", isComparable: true, sort: 91 },
      { key: K_FLAG, label: "کنترل از راه دور", kind: "bool", isComparable: true, sort: 92 },
      { key: K_BODY, label: "جنس بدنه", kind: "text", isComparable: true, sort: 93 },
      { key: K_QUIET, label: "یادداشت داخلی", kind: "text", isComparable: false, sort: 94 },
    ])
    .returning({ id: attributesTable.id, key: attributesTable.key });
  const attrId = (key: string): number => attrRows.find((a) => a.key === key)?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values(
      ["a", "b", "c", "d", "archived"].map((suffix, i) => ({
        slug: `${PREFIX}-${suffix}`,
        name: `کالای ${suffix}`,
        displayName: `کالای ${suffix}`,
        brandId,
        status: suffix === "archived" ? ("archived" as const) : ("active" as const),
        visibility: "public" as const,
        price: 1_000_000 * (i + 1),
        stockPolicy: "untracked" as const,
      })),
    )
    .returning({ id: products.id, slug: products.slug });
  const idOf = (suffix: string): number =>
    rows.find((r) => r.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const f: Fixture = {
    brandId,
    powerId: attrId(K_POWER),
    flagId: attrId(K_FLAG),
    bodyId: attrId(K_BODY),
    quietId: attrId(K_QUIET),
    aId: idOf("a"),
    bId: idOf("b"),
    cId: idOf("c"),
    dId: idOf("d"),
    archivedId: idOf("archived"),
  };

  await tx.insert(productAttributeValues).values([
    { productId: f.aId, attributeId: f.powerId, valueNum: "1200" },
    { productId: f.bId, attributeId: f.powerId, valueNum: "1200" },
    { productId: f.cId, attributeId: f.powerId, valueNum: "1200" },
    { productId: f.aId, attributeId: f.flagId, valueNum: "1" },
    { productId: f.bId, attributeId: f.flagId, valueNum: "0" },
    { productId: f.aId, attributeId: f.bodyId, valueText: "فولاد" },
    { productId: f.bId, attributeId: f.bodyId, valueText: "کروم" },
    { productId: f.aId, attributeId: f.quietId, valueText: "پنهان" },
  ]);

  await tx.insert(productSpecs).values([
    { productId: f.aId, label: "وزن", value: "۳ کیلوگرم", sort: 0 },
    { productId: f.aId, label: "توان مصرفی", value: "۱۲۰۰ وات", sort: 1 },
    { productId: f.bId, label: "توان مصرفی", value: "۱۲۰۰ وات", sort: 0 },
    { productId: f.bId, label: "گارانتی", value: "۱۸ ماه", sort: 1 },
  ]);

  return f;
}

describe.skipIf(!hasTestDb())("catalog/attributes against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("listAttributes filters and orders", async () => {
    await run(async (tx, f) => {
      const all = await listAttributes(tx);
      const mine = all.filter((a) => a.key.startsWith("attrtest_"));
      expect(mine.map((a) => a.key)).toEqual([K_POWER, K_FLAG, K_BODY, K_QUIET]);
      expect(mine[0]?.unit).toBe("W");

      const comparable = await listAttributes(tx, { comparableOnly: true });
      expect(comparable.some((a) => a.id === f.quietId)).toBe(false);
      expect(comparable.some((a) => a.id === f.powerId)).toBe(true);
    });
  }, 60_000);

  it("key regex rejected on write, key immutable, duplicate key conflicts", async () => {
    await run(async (tx, f) => {
      const base = {
        label: "برچسب",
        unit: null,
        kind: "text" as const,
        isFilterable: false,
        isComparable: false,
        sort: 5,
      };
      await expectAppError(upsertAttribute(tx, { ...base, key: "Color" }, ACTOR), "VALIDATION");
      await expectAppError(upsertAttribute(tx, { ...base, key: "رنگ" }, ACTOR), "VALIDATION");
      // a new attribute whose key is taken
      await expectAppError(upsertAttribute(tx, { ...base, key: K_POWER }, ACTOR), "CONFLICT");
      // renaming an existing key
      await expectAppError(
        upsertAttribute(tx, { ...base, id: f.bodyId, key: "attrtest_body2" }, ACTOR),
        "CONFLICT",
      );

      const created = await upsertAttribute(tx, { ...base, key: "attrtest_new" }, ACTOR);
      expect(created.id).toBeGreaterThan(0);
      expect(created.tags).toContain("catalog");
      const updated = await upsertAttribute(
        tx,
        { ...base, id: created.id, key: "attrtest_new", label: "برچسب تازه", sort: 9 },
        ACTOR,
      );
      expect(updated.id).toBe(created.id);
      const after = (await listAttributes(tx)).find((a) => a.id === created.id);
      expect(after?.label).toBe("برچسب تازه");
      expect(after?.sort).toBe(9);
    });
  }, 60_000);

  it("kind immutable with values", async () => {
    await run(async (tx, f) => {
      const input = {
        id: f.powerId,
        key: K_POWER,
        label: "توان",
        unit: "W",
        isFilterable: false,
        isComparable: true,
        sort: 91,
      };
      // EDGE CASE: kind change after values exist → VALIDATION
      await expectAppError(upsertAttribute(tx, { ...input, kind: "text" }, ACTOR), "VALIDATION");
      // the same kind is not a change
      const same = await upsertAttribute(tx, { ...input, kind: "number" }, ACTOR);
      expect(same.id).toBe(f.powerId);

      // an attribute with no values may still change kind
      await tx
        .delete(productAttributeValues)
        .where(eq(productAttributeValues.attributeId, f.quietId));
      const changed = await upsertAttribute(
        tx,
        {
          id: f.quietId,
          key: K_QUIET,
          label: "یادداشت داخلی",
          unit: null,
          kind: "bool",
          isFilterable: false,
          isComparable: false,
          sort: 94,
        },
        ACTOR,
      );
      expect(changed.id).toBe(f.quietId);
    });
  }, 60_000);

  it("kind/value consistency", async () => {
    await run(async (tx, f) => {
      const bad = (values: Parameters<typeof setProductAttributeValues>[2]): Promise<void> =>
        setProductAttributeValues(tx, f.dId, values, ACTOR);

      // EDGE CASE: a number attribute carrying valueText
      await expectAppError(bad([{ key: K_POWER, valueText: "1.5", valueNum: null }]), "VALIDATION");
      await expectAppError(bad([{ key: K_POWER, valueText: null, valueNum: null }]), "VALIDATION");
      await expectAppError(bad([{ key: K_BODY, valueText: null, valueNum: 3 }]), "VALIDATION");
      await expectAppError(bad([{ key: K_BODY, valueText: "  ", valueNum: null }]), "VALIDATION");
      await expectAppError(bad([{ key: K_FLAG, valueText: null, valueNum: 2 }]), "VALIDATION");
      await expectAppError(
        bad([{ key: "attrtest_missing", valueText: "x", valueNum: null }]),
        "VALIDATION",
      );
      await expectAppError(
        bad([
          { key: K_BODY, valueText: "فولاد", valueNum: null },
          { key: K_BODY, valueText: "کروم", valueNum: null },
        ]),
        "VALIDATION",
      );
      await expectAppError(setProductAttributeValues(tx, 987_654_321, [], ACTOR), "NOT_FOUND");

      // the valid write replaces everything and produces the facet tokens
      await setProductAttributeValues(
        tx,
        f.dId,
        [
          { key: K_POWER, valueText: null, valueNum: 900 },
          { key: K_FLAG, valueText: null, valueNum: 1 },
          { key: K_BODY, valueText: "شیشه", valueNum: null },
        ],
        ACTOR,
      );
      const values = await valuesForProduct(tx, f.dId);
      expect(values.map((v) => v.key)).toEqual([K_POWER, K_FLAG, K_BODY]);
      expect(values.map((v) => v.token)).toEqual(["900", "1", "شیشه"]);
      expect(values[0]?.valueNum).toBe(900);

      // replace-all: a second write drops what it does not repeat
      await setProductAttributeValues(
        tx,
        f.dId,
        [{ key: K_BODY, valueText: "چوب", valueNum: null }],
        ACTOR,
      );
      const after = await valuesForProduct(tx, f.dId);
      expect(after.map((v) => v.key)).toEqual([K_BODY]);
      expect(after[0]?.valueText).toBe("چوب");
    });
  }, 60_000);

  it("compare caps at 4, drops archived, allEqual semantics, spec union order", async () => {
    await run(async (tx, f) => {
      // EDGE CASE: 5 ids → the first 4 are used, no throw
      const capped = await compareRows(tx, [f.aId, f.bId, f.cId, f.dId, f.archivedId]);
      expect(capped.products).toHaveLength(COMPARE_MAX);
      expect(capped.products.map((p) => p.id)).toEqual([f.aId, f.bId, f.cId, f.dId]);

      // EDGE CASE: an archived id is dropped and the table is still returned
      const dropped = await compareRows(tx, [f.archivedId, f.aId]);
      expect(dropped.products.map((p) => p.id)).toEqual([f.aId]);
      expect(dropped.rows.length).toBeGreaterThan(0);

      const table = await compareRows(tx, [f.aId, f.bId, f.cId]);
      expect(table.products.map((p) => p.id)).toEqual([f.aId, f.bId, f.cId]);

      const mine = table.rows.filter((r) => r.kind === "spec" || r.key.startsWith("attrtest_"));
      expect(mine.map((r) => r.key)).toEqual([
        K_POWER,
        K_FLAG,
        K_BODY,
        // the UNION of spec labels, in first-seen order across the products in `ids` order
        "spec:وزن",
        "spec:توان مصرفی",
        "spec:گارانتی",
      ]);

      const rowOf = (key: string): (typeof table.rows)[number] | undefined =>
        table.rows.find((r) => r.key === key);
      // identical values everywhere → allEqual true
      expect(rowOf(K_POWER)?.values).toEqual(["۱٬۲۰۰ W", "۱٬۲۰۰ W", "۱٬۲۰۰ W"]);
      expect(rowOf(K_POWER)?.allEqual).toBe(true);
      // a null present → allEqual false
      expect(rowOf(K_FLAG)?.values).toEqual(["دارد", "ندارد", null]);
      expect(rowOf(K_FLAG)?.allEqual).toBe(false);
      expect(rowOf(K_BODY)?.values).toEqual(["فولاد", "کروم", null]);
      // a spec label present on only one product → row with nulls, allEqual false
      expect(rowOf("spec:وزن")?.values).toEqual(["۳ کیلوگرم", null, null]);
      expect(rowOf("spec:وزن")?.allEqual).toBe(false);
      // identical spec values on two products, missing on the third
      expect(rowOf("spec:توان مصرفی")?.values).toEqual(["۱۲۰۰ وات", "۱۲۰۰ وات", null]);
      expect(rowOf("spec:توان مصرفی")?.allEqual).toBe(false);
      // a non-comparable attribute never becomes a row
      expect(rowOf(K_QUIET)).toBeUndefined();

      expect(await compareRows(tx, [])).toEqual({ products: [], rows: [] });
      expect((await compareRows(tx, [987_654_321])).products).toEqual([]);
    });
  }, 60_000);
});
