import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brands, productModels, products } from "@namilux/db";
import type { DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { adminProductIds, queryAdmin } from "../products.repo";
import { listModels } from "../models-admin";

describe.skipIf(!hasTestDb())("admin search and filtered bulk scope", () => {
  let testDb: TestDb;
  beforeAll(async () => { testDb = await createTestDb(); });
  afterAll(async () => { await testDb?.close(); });

  async function run(names: string[], check: (tx: DbTx, brandId: number, ids: number[]) => Promise<void>) {
    await withTestTx(testDb.db, async (tx) => {
      const [brand] = await tx.insert(brands).values({ slug: "admin-search-regression", nameFa: "برند آزمون جستجو", nameEn: "Search test" }).returning({ id: brands.id });
      if (!brand) throw new Error("missing fixture brand");
      const rows = await tx.insert(products).values(names.map((name, i) => ({ slug: `admin-search-regression-${i}`, name, displayName: name, brandId: brand.id, price: 1000, status: "active" as const }))).returning({ id: products.id });
      await check(tx, brand.id, rows.map((row) => row.id));
    });
  }

  it("normalizes Persian/Arabic letters, digits and word separators in both list and bulk IDs", async () => {
    await run(["كارد چاقوي ۱۲۰ ست\u200cچاقو", "قابلمه"], async (tx, brandId, ids) => {
      for (const q of ["کارد", "چاقوی", "١٢٠", "120", "ست چاقو", "ست   چاقو"]) {
        const filter = { brandId, q };
        expect((await queryAdmin(tx, filter)).rows.map((row) => row.id)).toEqual([ids[0]]);
        expect(await adminProductIds(tx, filter)).toEqual([ids[0]]);
      }
    });
  });

  it("treats percent and underscore as literal search text", async () => {
    await run(["چاقو 50%", "چاقو مدل_a", "چاقو معمولی"], async (tx, brandId, ids) => {
      expect(await adminProductIds(tx, { brandId, q: "%" })).toEqual([ids[0]]);
      expect(await adminProductIds(tx, { brandId, q: "_" })).toEqual([ids[1]]);
    });
  });

  it("resolves an older selected model by id and normalizes its search label", async () => {
    await run(["مدل آزمایش"], async (tx, brandId) => {
      const rows = await tx.insert(productModels).values(Array.from({ length: 25 }, (_, i) => ({ key: `admin-model-regression-${i}`, displayName: i === 0 ? "كارد ۱۲۳" : `مدل آزمایش ${i}`, brandId }))).returning({ id: productModels.id });
      const firstId = rows[0]?.id;
      if (firstId === undefined) throw new Error("missing model fixture");
      expect((await listModels(tx, { brandId })).some((g) => g.id === firstId)).toBe(false);
      expect((await listModels(tx, { id: firstId })).map((g) => g.id)).toEqual([firstId]);
      expect((await listModels(tx, { brandId, q: "کارد 123" })).map((g) => g.id)).toEqual([firstId]);
    });
  });

  it("returns every match across pages and keeps the total on an out-of-range page", async () => {
    await run(Array.from({ length: 53 }, (_, i) => `چاقو آزمون ${i}`), async (tx, brandId, ids) => {
      const filter = { brandId, q: "چاقو", pageSize: 50 as const, sort: "name" as const };
      const first = await queryAdmin(tx, { ...filter, page: 1 });
      const second = await queryAdmin(tx, { ...filter, page: 2 });
      const pastEnd = await queryAdmin(tx, { ...filter, page: 9 });
      expect(first.rows).toHaveLength(50);
      expect(second.rows).toHaveLength(3);
      expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(53);
      expect(first.total).toBe(53);
      expect(second.total).toBe(53);
      expect(pastEnd).toEqual({ rows: [], total: 53 });
      expect(await adminProductIds(tx, filter)).toEqual([...ids].sort((a, b) => a - b));
    });
  });
});
