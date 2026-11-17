import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { wishlist } from "../wishlist";

describe.skipIf(!hasTestDb())("customers/wishlist against Postgres", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("replace keeps known products and drops unknown ids", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId, customerId } = await seedMinimal(tx);
      const kept = await wishlist.replace(tx, customerId, [productId, 999999]);
      expect(kept).toEqual([productId]);
      expect(await wishlist.get(tx, customerId)).toEqual([productId]);
    });
  });

  it("add is idempotent", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId, customerId } = await seedMinimal(tx);
      await wishlist.add(tx, customerId, productId);
      await wishlist.add(tx, customerId, productId);
      expect(await wishlist.get(tx, customerId)).toEqual([productId]);
    });
  });
});
