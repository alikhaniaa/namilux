import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDbAs, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { auditLog, eq, inventoryMovements, inventoryReservations, jobs, orders, products } from "@namilux/db";
import { ulid } from "../../ids";
import { loadProductsForQuote } from "../repo";
import { checkReservable } from "../reservations";
import { adjustStock, availableStock } from "../stock";
import { markProductAvailable, markProductUnavailable } from "../unavailable";
import { STOCK_NOTE_AVAILABLE, STOCK_NOTE_UNAVAILABLE, STOCK_RESTORE_MAX } from "../../constants";

const STAFF = { type: "staff" as const, id: "01STAFF" };

describe.skipIf(!hasTestDb())("one-click stock switch", () => {
  let handle: TestDb;
  let admin: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
    admin = await createTestDbAs("admin");
  });
  afterEach(async () => { await truncateAll(handle.db); });
  afterAll(async () => { await admin?.close(); await handle?.close(); });
  async function product(untracked = false): Promise<number> {
    const [p] = await handle.db.insert(products).values({
      slug: `unavailable-${ulid()}`, name: "کالای آزمون", displayName: "کالای آزمون", status: "active",
    visibility: "public", price: 10000, stockPolicy: untracked ? "untracked" : "track", allowBackorder: true,
      updatedAt: new Date("2020-01-01T00:00:00Z"),
    }).returning({ id: products.id });
    return p!.id;
  }
  it("zeros counted stock through its ledger, stops preorder and checkout, preserves the product and price, and is idempotent", async () => {
    const id = await product();
    await adjustStock(handle.db, id, 5, "restock", { type: "system", id: null });
    await markProductUnavailable(admin.db, id, STAFF);
    await markProductUnavailable(admin.db, id, STAFF);
    const [p] = await handle.db.select().from(products).where(eq(products.id, id));
    expect(p).toMatchObject({ stockQty: 0, stockPolicy: "track", allowBackorder: false, price: 10000, status: "active", visibility: "public" });
    expect(p!.updatedAt.getTime()).toBeGreaterThan(new Date("2020-01-01T00:00:00Z").getTime());
    const ledger = await handle.db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, id));
    expect(ledger.map(r => r.delta)).toEqual([5, -5]);
    expect(await availableStock(handle.db, id)).toBe(0);
    const [q] = await loadProductsForQuote(handle.db, [id], { lock: "none" });
    expect(checkReservable(q!, 0, 1)).toEqual({ ok: false, available: 0 });
    expect(await handle.db.select().from(auditLog)).toHaveLength(1);
    const refreshJobs = await handle.db.select().from(jobs).where(eq(jobs.type, "cache.revalidate"));
    expect(refreshJobs.some(job => Array.isArray(job.payloadJson["tags"]) && job.payloadJson["tags"].includes("catalog"))).toBe(true);
  });
  it("also handles untracked stock at zero without writing a zero movement", async () => {
    const id = await product(true);
    await markProductUnavailable(admin.db, id, STAFF);
    expect(await availableStock(handle.db, id)).toBe(0);
    expect(await handle.db.select().from(inventoryMovements)).toHaveLength(0);
  });
  it("preserves stock and flags when a payment reservation is unresolved, even just expired", async () => {
    const id = await product();
    await adjustStock(handle.db, id, 3, "restock", { type: "system", id: null });
    const oid = ulid();
    await handle.db.insert(orders).values({ id: oid, code: "NL-TEST1", phone: "09121110000" });
    await handle.db.insert(inventoryReservations).values({ id: ulid(), productId: id, orderId: oid, qty: 1, expiresAt: new Date(Date.now() - 1000) });
    await expect(markProductUnavailable(admin.db, id, STAFF)).rejects.toMatchObject({ code: "CONFLICT" });
    const [p] = await handle.db.select().from(products).where(eq(products.id, id));
    expect(p).toMatchObject({ stockQty: 3, allowBackorder: true });
    expect(await handle.db.select().from(auditLog)).toHaveLength(0);
  });
  it("serializes concurrent clicks into one adjustment", async () => {
    const id = await product();
    await adjustStock(handle.db, id, 2, "restock", { type: "system", id: null });
    await Promise.all([markProductUnavailable(admin.db, id, STAFF), markProductUnavailable(admin.db, id, STAFF)]);
    expect(await handle.db.select().from(inventoryMovements)).toHaveLength(2);
    expect(await handle.db.select().from(auditLog)).toHaveLength(1);
  });
  it("rejects missing products and customer callers", async () => {
    await expect(markProductUnavailable(admin.db, 999999, STAFF)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markProductUnavailable(admin.db, 1, { type: "customer", id: "c" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("puts the entered quantity back through the ledger, tells subscribers once, and ignores a second click", async () => {
    const id = await product();
    await adjustStock(handle.db, id, 5, "restock", { type: "system", id: null });
    await markProductUnavailable(admin.db, id, STAFF);
    const backInStock = async (): Promise<number> => (await handle.db.select().from(jobs).where(eq(jobs.type, "stock.back_in_stock"))).length;
    const notifiedBefore = await backInStock();
    await markProductAvailable(admin.db, id, 5, STAFF);
    await markProductAvailable(admin.db, id, 5, STAFF);
    const [p] = await handle.db.select().from(products).where(eq(products.id, id));
    expect(p).toMatchObject({ stockQty: 5, stockPolicy: "track", allowBackorder: false, price: 10000, status: "active", visibility: "public" });
    const ledger = await handle.db.select().from(inventoryMovements).where(eq(inventoryMovements.productId, id)).orderBy(inventoryMovements.id);
    expect(ledger.map(r => [r.delta, r.note])).toEqual([[5, null], [-5, STOCK_NOTE_UNAVAILABLE], [5, STOCK_NOTE_AVAILABLE]]);
    expect(await availableStock(handle.db, id)).toBe(5);
    const [q] = await loadProductsForQuote(handle.db, [id], { lock: "none" });
    expect(checkReservable(q!, 0, 1)).toMatchObject({ ok: true });
    expect((await handle.db.select().from(auditLog)).map(r => r.action).sort()).toEqual(["product.stock.available", "product.stock.unavailable"]);
    expect(await backInStock()).toBe(notifiedBefore + 1);
  });
  it("serializes concurrent restores into one movement", async () => {
    const id = await product();
    await markProductUnavailable(admin.db, id, STAFF);
    await Promise.all([markProductAvailable(admin.db, id, 3, STAFF), markProductAvailable(admin.db, id, 3, STAFF)]);
    const [p] = await handle.db.select().from(products).where(eq(products.id, id));
    expect(p!.stockQty).toBe(3);
    expect(await handle.db.select().from(inventoryMovements)).toHaveLength(1);
  });
  it("leaves a product that can already be sold alone", async () => {
    const untracked = await product(true);
    const preorder = await product();
    const stocked = await product();
    await markProductUnavailable(admin.db, stocked, STAFF);
    await adjustStock(handle.db, stocked, 2, "restock", { type: "system", id: null });
    for (const id of [untracked, preorder, stocked]) await markProductAvailable(admin.db, id, 4, STAFF);
    const rows = await handle.db.select({ id: products.id, stockQty: products.stockQty }).from(products);
    expect(new Map(rows.map(r => [r.id, r.stockQty]))).toEqual(new Map([[untracked, 0], [preorder, 0], [stocked, 2]]));
    expect(await handle.db.select().from(inventoryMovements)).toHaveLength(1);
    expect((await handle.db.select().from(auditLog)).filter(r => r.action === "product.stock.available")).toHaveLength(0);
  });
  it("rejects bad quantities, missing products and customer callers on the way back", async () => {
    const id = await product();
    await markProductUnavailable(admin.db, id, STAFF);
    for (const qty of [0, -1, 1.5, STOCK_RESTORE_MAX + 1]) {
      await expect(markProductAvailable(admin.db, id, qty, STAFF)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(markProductAvailable(admin.db, 999999, 1, STAFF)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(markProductAvailable(admin.db, id, 1, { type: "customer", id: "c" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await handle.db.select().from(inventoryMovements)).toHaveLength(0);
  });
});
