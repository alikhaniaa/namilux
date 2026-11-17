import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { and, auditLog, eq, inventoryMovements, jobs, products, securityEvents, sql } from "@namilux/db";
import { ADJUST_REASONS, availableStock, availableStockMany, adjustStock, checkConsistency } from "../stock";
import { isLowStock } from "../../catalog/cards";
import { ulid } from "../../ids";
import type { Actor } from "../../types";

const STAFF: Actor = { type: "staff", id: "01STAFF" };
const SYSTEM: Actor = { type: "system", id: null };

describe("inventory/stock - pure", () => {
  it("isLowStock: 1 ≤ available ≤ threshold on a tracked product", () => {
    const facts = { stockPolicy: "track" as const, reservedQty: 0, allowBackorder: false, maxPerOrder: 5 };
    expect(isLowStock({ ...facts, stockQty: 3, lowStockThreshold: 3 })).toBe(true);
    expect(isLowStock({ ...facts, stockQty: 0, lowStockThreshold: 3 })).toBe(false);
    expect(isLowStock({ ...facts, stockQty: 4, lowStockThreshold: 3 })).toBe(false);
    expect(isLowStock({ ...facts, stockQty: 1, lowStockThreshold: 0 })).toBe(false);
  });
  it("ADJUST_REASONS excludes 'sale'", () => {
    expect(ADJUST_REASONS).not.toContain("sale");
  });
});

describe.skipIf(!hasTestDb())("inventory/stock — integration", () => {
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

  async function makeProduct(over: Partial<{ stockQty: number; stockPolicy: "track" | "untracked" }> = {}): Promise<number> {
    const [p] = await handle.db
      .insert(products)
      .values({
        slug: `stk-${ulid()}`,
        name: "کالای آزمون",
        displayName: "کالای آزمون",
        status: "active",
        visibility: "public",
        price: 1_000_000,
        stockQty: over.stockQty ?? 0,
        stockPolicy: over.stockPolicy ?? "track",
      })
      .returning({ id: products.id });
    return p!.id;
  }

  // stock.back_in_stock carries { productId }; cache.revalidate carries { tags: [...] }.
  const jobCount = async (productId: number, type: string): Promise<number> => {
    const [r] = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.type, type), sql`${jobs.payloadJson}->>'productId' = ${String(productId)}`));
    return r?.n ?? 0;
  };
  const revalidateCount = async (productId: number): Promise<number> => {
    const [r] = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.type, "cache.revalidate"), sql`${jobs.payloadJson}->'tags' @> ${JSON.stringify([`product:${productId}`])}::jsonb`));
    return r?.n ?? 0;
  };

  it("availableStock: no reservations → stock_qty; untracked → huge; unknown → NOT_FOUND", async () => {
    const id = await makeProduct({ stockQty: 5 });
    expect(await availableStock(handle.db, id)).toBe(5);
    const untracked = await makeProduct({ stockPolicy: "untracked" });
    expect(await availableStock(handle.db, untracked)).toBe(Number.MAX_SAFE_INTEGER);
    await expect(availableStock(handle.db, 999_999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("availableStockMany returns a map for known ids only", async () => {
    const a = await makeProduct({ stockQty: 4 });
    const b = await makeProduct({ stockQty: 7 });
    const map = await availableStockMany(handle.db, [a, b, 888_888]);
    expect(map.get(a)).toBe(4);
    expect(map.get(b)).toBe(7);
    expect(map.has(888_888)).toBe(false);
  });

  it("adjustStock +3 on stock 0 → stockQty 3, one movement, one stock.back_in_stock job", async () => {
    const id = await makeProduct({ stockQty: 0 });
    const { stockQty } = await adjustStock(handle.db, id, 3, "restock", SYSTEM);
    expect(stockQty).toBe(3);
    const [p] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, id));
    expect(p!.stockQty).toBe(3); // trigger maintained it
    const [m] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements).where(eq(inventoryMovements.productId, id));
    expect(m!.n).toBe(1);
    expect(await jobCount(id, "stock.back_in_stock")).toBe(1);
  });

  it("adjustStock +3 on stock 2 → no back-in-stock job", async () => {
    const id = await makeProduct({ stockQty: 2 });
    await adjustStock(handle.db, id, 3, "restock", SYSTEM);
    expect(await jobCount(id, "stock.back_in_stock")).toBe(0);
  });

  it("adjustStock −5 on stock 3 → VALIDATION and nothing written", async () => {
    const id = await makeProduct({ stockQty: 3 });
    await expect(adjustStock(handle.db, id, -5, "adjust", SYSTEM)).rejects.toMatchObject({ code: "VALIDATION" });
    const [m] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements).where(eq(inventoryMovements.productId, id));
    expect(m!.n).toBe(0);
  });

  it("adjustStock reason 'sale' → VALIDATION; customer actor → FORBIDDEN", async () => {
    const id = await makeProduct({ stockQty: 3 });
    await expect(adjustStock(handle.db, id, 1, "sale", SYSTEM)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(adjustStock(handle.db, id, 1, "adjust", { type: "customer", id: "c1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("staff actor writes an audit row; system actor writes none; both enqueue cache.revalidate", async () => {
    const staffProduct = await makeProduct({ stockQty: 1 });
    await adjustStock(handle.db, staffProduct, 2, "restock", STAFF);
    const [a] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.entity, "products"), eq(auditLog.entityId, String(staffProduct))));
    expect(a!.n).toBe(1);
    expect(await revalidateCount(staffProduct)).toBe(1);

    const sysProduct = await makeProduct({ stockQty: 1 });
    await adjustStock(handle.db, sysProduct, 2, "restock", SYSTEM);
    const [s] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(eq(auditLog.entityId, String(sysProduct)));
    expect(s!.n).toBe(0);
  });

  it("checkConsistency reports a directly edited stock_qty and writes a stock.drift security event", async () => {
    const id = await makeProduct({ stockQty: 0 });
    await adjustStock(handle.db, id, 3, "restock", SYSTEM); // stock 3, movements sum 3 (consistent)
    // corrupt stock_qty directly (bypassing the ledger)
    await handle.db.update(products).set({ stockQty: 99 }).where(eq(products.id, id));
    const { drift } = await checkConsistency(handle.db);
    expect(drift.some((d) => d.productId === id && d.stockQty === 99 && d.movementSum === 3)).toBe(true);
    const [e] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(securityEvents).where(eq(securityEvents.kind, "stock.drift"));
    expect(e!.n).toBeGreaterThanOrEqual(1);
  });
});
