import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { cart, normalizeLines } from "../cart";
import type { CartLine } from "../../types";

const L = (id: number, qty: number, addedAt: string): CartLine => ({ id, qty, addedAt });

describe("customers/cart - pure normalizeLines", () => {
  it("dedupes by id (sums), drops qty ≤ 0, sorts by addedAt", () => {
    const out = normalizeLines([
      L(2, 1, "2026-01-02T00:00:00.000Z"),
      L(1, 2, "2026-01-01T00:00:00.000Z"),
      L(1, 3, "2026-01-03T00:00:00.000Z"),
      L(9, 0, "2026-01-01T00:00:00.000Z"),
    ]);
    expect(out.map((l) => l.id)).toEqual([1, 2]);
    expect(out.find((l) => l.id === 1)?.qty).toBe(5);
    expect(out.some((l) => l.id === 9)).toBe(false);
  });
});

describe.skipIf(!hasTestDb())("customers/cart against Postgres", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("replace then get round-trips; older replace is ignored", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId, customerId } = await seedMinimal(tx);
      const t2 = "2026-02-02T00:00:00.000Z";
      const t1 = "2026-02-01T00:00:00.000Z";
      const r = await cart.replace(tx, customerId, [L(productId, 2, t2)], t2);
      expect(r.lines).toEqual([{ id: productId, qty: 2, addedAt: t2 }]);
      // an older write is discarded (last-write-wins by updatedAt)
      const older = await cart.replace(tx, customerId, [L(productId, 9, t1)], t1);
      expect(older.lines[0]?.qty).toBe(2);
    });
  });

  it("merge keeps the larger snapshot quantity and is safe to replay", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId, customerId } = await seedMinimal(tx);
      const t = "2026-02-01T00:00:00.000Z";
      await cart.replace(tx, customerId, [L(productId, 2, t)], t);
      const merged = await cart.merge(tx, customerId, [L(productId, 3, t), L(999999, 1, t)]);
      expect(merged).toEqual([{ id: productId, qty: 3, addedAt: t }]);
      for (let i = 0; i < 4; i++) {
        expect(await cart.merge(tx, customerId, merged)).toEqual(merged);
      }
    });
  });
});
