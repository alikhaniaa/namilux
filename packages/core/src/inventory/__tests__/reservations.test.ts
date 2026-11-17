import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, orders, products } from "@namilux/db";
import { ulid } from "../../ids";
import type { ProductStockRow } from "../repo";
import { activeReservedQty } from "../repo";
import {
  checkReservable,
  consumeReservations,
  expireReservations,
  releaseReservations,
  reserve,
} from "../reservations";
import { availableStock } from "../stock";

function row(over: Partial<ProductStockRow>): ProductStockRow {
  return {
    id: 1,
    stockPolicy: "track",
    stockQty: 3,
    allowBackorder: false,
    maxPerOrder: 5,
    lowStockThreshold: 3,
    status: "active",
    visibility: "public",
    price: 1_000_000,
    ...over,
  };
}

describe("inventory/checkReservable - pure", () => {
  it("untracked → ok regardless of qty", () => {
    expect(checkReservable(row({ stockPolicy: "untracked", stockQty: 0 }), 0, 99)).toEqual({ ok: true });
  });
  it("allowBackorder → ok regardless of stock", () => {
    expect(checkReservable(row({ allowBackorder: true, stockQty: 0 }), 5, 10)).toEqual({ ok: true });
  });
  it("stock 3, reserved 1, qty 2 → ok; qty 3 → { ok:false, available:2 }", () => {
    expect(checkReservable(row({ stockQty: 3 }), 1, 2)).toEqual({ ok: true });
    expect(checkReservable(row({ stockQty: 3 }), 1, 3)).toEqual({ ok: false, available: 2 });
  });
  it("stock 0 → { ok:false, available:0 }; reserved > stock → available 0, never negative", () => {
    expect(checkReservable(row({ stockQty: 0 }), 0, 1)).toEqual({ ok: false, available: 0 });
    expect(checkReservable(row({ stockQty: 3 }), 5, 1)).toEqual({ ok: false, available: 0 });
  });
});

describe.skipIf(!hasTestDb())("inventory/reservations — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function makeProduct(
    over: Partial<{ stockQty: number; allowBackorder: boolean; stockPolicy: "track" | "untracked" }> = {},
  ): Promise<number> {
    const [p] = await handle.db
      .insert(products)
      .values({
        slug: `res-${ulid()}`,
        name: "کالای آزمون",
        displayName: "کالای آزمون",
        status: "active",
        visibility: "public",
        price: 1_000_000,
        stockQty: over.stockQty ?? 3,
        allowBackorder: over.allowBackorder ?? false,
        stockPolicy: over.stockPolicy ?? "track",
      })
      .returning({ id: products.id });
    return p!.id;
  }

  async function makeOrders(n: number): Promise<string[]> {
    const rows = Array.from({ length: n }, () => ({ id: ulid(), code: `NL-${ulid().slice(-5)}`, phone: "09121110000" }));
    await handle.db.insert(orders).values(rows);
    return rows.map((r) => r.id);
  }

  it(
    "stock 3: 50 concurrent reserve(qty 1) → exactly 3 fulfilled, 47 OUT_OF_STOCK, SUM(active) = 3",
    async () => {
      const productId = await makeProduct({ stockQty: 3 });
      const orderIds = await makeOrders(50);
      const results = await Promise.allSettled(
        orderIds.map((oid) => handle.db.transaction((tx) => reserve(tx, oid, [{ productId, qty: 1 }], 30))),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const rejected = results.filter((r) => r.status === "rejected");
      expect(ok).toBe(3);
      expect(rejected).toHaveLength(47);
      expect(rejected.every((r) => (r.reason as { code?: string }).code === "OUT_OF_STOCK")).toBe(true);
      expect(await activeReservedQty(handle.db, productId)).toBe(3);
    },
    30_000,
  );

  it("stock 3: two concurrent reserve(qty 2) → one ok, one OUT_OF_STOCK with available 1", async () => {
    const productId = await makeProduct({ stockQty: 3 });
    const [a, b] = await makeOrders(2);
    const results = await Promise.allSettled([
      handle.db.transaction((tx) => reserve(tx, a!, [{ productId, qty: 2 }], 30)),
      handle.db.transaction((tx) => reserve(tx, b!, [{ productId, qty: 2 }], 30)),
    ]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as { details?: { available?: number } }).details?.available).toBe(1);
  });

  it("stock 3 with allow_backorder: 50 concurrent reserve all fulfilled; availableStock reports 0", async () => {
    const productId = await makeProduct({ stockQty: 3, allowBackorder: true });
    const orderIds = await makeOrders(50);
    const results = await Promise.allSettled(
      orderIds.map((oid) => handle.db.transaction((tx) => reserve(tx, oid, [{ productId, qty: 1 }], 30))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(50);
    expect(await availableStock(handle.db, productId)).toBe(0);
  }, 30_000);

  it("untracked product: 50 concurrent reserve all fulfilled", async () => {
    const productId = await makeProduct({ stockPolicy: "untracked", stockQty: 0 });
    const orderIds = await makeOrders(50);
    const results = await Promise.allSettled(
      orderIds.map((oid) => handle.db.transaction((tx) => reserve(tx, oid, [{ productId, qty: 1 }], 30))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(50);
  }, 30_000);

  it("reserve rolls back atomically: line 1 ok, line 2 OUT_OF_STOCK → zero reservations", async () => {
    const good = await makeProduct({ stockQty: 5 });
    const bad = await makeProduct({ stockQty: 0 });
    const [oid] = await makeOrders(1);
    await expect(
      handle.db.transaction((tx) =>
        reserve(tx, oid!, [
          { productId: good, qty: 1 },
          { productId: bad, qty: 1 },
        ], 30),
      ),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    expect(await activeReservedQty(handle.db, good)).toBe(0);
  });

  it("reserve rejects qty 0 / ttlMin 0 (VALIDATION) and treats empty lines as a no-op", async () => {
    const productId = await makeProduct({ stockQty: 3 });
    const [oid] = await makeOrders(1);
    await handle.db.transaction((tx) => reserve(tx, oid!, [], 30)); // no-op, no throw
    await expect(handle.db.transaction((tx) => reserve(tx, oid!, [{ productId, qty: 0 }], 30))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(handle.db.transaction((tx) => reserve(tx, oid!, [{ productId, qty: 1 }], 0))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("releaseReservations twice: second is a no-op and released rows are not active", async () => {
    const productId = await makeProduct({ stockQty: 3 });
    const [oid] = await makeOrders(1);
    await handle.db.transaction((tx) => reserve(tx, oid!, [{ productId, qty: 2 }], 30));
    expect(await activeReservedQty(handle.db, productId)).toBe(2);
    await releaseReservations(handle.db, oid!);
    await releaseReservations(handle.db, oid!);
    expect(await activeReservedQty(handle.db, productId)).toBe(0);
  });

  it("expireReservations releases expired rows and returns each order id once", async () => {
    const productId = await makeProduct({ stockQty: 5 });
    const [oid] = await makeOrders(1);
    await handle.db.transaction((tx) =>
      reserve(tx, oid!, [
        { productId, qty: 1 },
        { productId, qty: 1 },
      ], 1),
    );
    const future = new Date(Date.now() + 5 * 60_000);
    const res = await expireReservations(handle.db, future);
    expect(res.orders).toEqual([oid]);
    expect(await activeReservedQty(handle.db, productId)).toBe(0);
  });

  it("consumeReservations writes a sale movement per reservation, decrements stock; second call no-op", async () => {
    const productId = await makeProduct({ stockQty: 3 });
    const [oid] = await makeOrders(1);
    await handle.db.transaction((tx) => reserve(tx, oid!, [{ productId, qty: 2 }], 30));
    await handle.db.transaction((tx) => consumeReservations(tx, oid!, { type: "system", id: null }));
    const [p] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, productId));
    expect(p!.stockQty).toBe(1);
    await handle.db.transaction((tx) => consumeReservations(tx, oid!, { type: "system", id: null }));
    const [p2] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, productId));
    expect(p2!.stockQty).toBe(1);
  });

  it("consumeReservations when stock was adjusted to 0 meanwhile throws OUT_OF_STOCK and writes nothing", async () => {
    const productId = await makeProduct({ stockQty: 3 });
    const [oid] = await makeOrders(1);
    await handle.db.transaction((tx) => reserve(tx, oid!, [{ productId, qty: 2 }], 30));
    await handle.db.update(products).set({ stockQty: 0 }).where(eq(products.id, productId));
    await expect(
      handle.db.transaction((tx) => consumeReservations(tx, oid!, { type: "system", id: null })),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    const [p] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, productId));
    expect(p!.stockQty).toBe(0);
  });
});
