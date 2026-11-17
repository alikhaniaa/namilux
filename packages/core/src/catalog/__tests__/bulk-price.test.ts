import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { auditLog, eq, inArray, jobs as jobsTable, priceHistory, products } from "@namilux/db";
import { staffActor } from "../../__tests__/support/fixtures";
import { ulid } from "../../ids";
import { applyOperation, bulkPrice, roundToman } from "../bulk-price";
import type { BulkPriceOperation } from "../bulk-price";

const op = (o: Partial<BulkPriceOperation> & Pick<BulkPriceOperation, "op">): BulkPriceOperation => ({
  value: 0,
  target: "price",
  round: null,
  ...o,
});

describe("catalog/bulk-price - applyOperation (pure)", () => {
  it("percent table", () => {
    expect(applyOperation({ price: 48_000_000, compareAt: null }, op({ op: "percent", value: -15 }))).toEqual({
      after: { price: 40_800_000, compareAt: null },
      saleEnded: false,
    });
    expect(applyOperation({ price: 41_500_000, compareAt: null }, op({ op: "percent", value: 10 }))).toEqual({
      after: { price: 45_650_000, compareAt: null },
      saleEnded: false,
    });
  });

  it("on-request guard: percent/fixed/round on price 0 skip on_request", () => {
    expect(applyOperation({ price: 0, compareAt: null }, op({ op: "percent", value: 10 }))).toEqual({ skip: "on_request" });
    expect(applyOperation({ price: 0, compareAt: null }, op({ op: "fixed", value: 100 }))).toEqual({ skip: "on_request" });
  });

  it("set prices an on-request product", () => {
    expect(applyOperation({ price: 0, compareAt: null }, op({ op: "set", value: 30_000_000 }))).toEqual({
      after: { price: 30_000_000, compareAt: null },
      saleEnded: false,
    });
  });

  it("negative skip", () => {
    expect(applyOperation({ price: 41_500_000, compareAt: null }, op({ op: "fixed", value: -50_000_000 }))).toEqual({
      skip: "negative",
    });
  });

  it("rounding table (half up)", () => {
    expect(roundToman(41_515_000, 10_000)).toBe(41_520_000);
    expect(roundToman(41_450_000, 100_000)).toBe(41_500_000);
    expect(applyOperation({ price: 41_515_000, compareAt: null }, op({ op: "round", round: 10_000 }))).toEqual({
      after: { price: 41_520_000, compareAt: null },
      saleEnded: false,
    });
  });

  it("sale ends when price passes compare-at (target price)", () => {
    expect(applyOperation({ price: 40_000_000, compareAt: 45_000_000 }, op({ op: "set", value: 46_000_000 }))).toEqual({
      after: { price: 46_000_000, compareAt: null },
      saleEnded: true,
    });
  });

  it("target compareAt below price → skip compare_below_price", () => {
    expect(
      applyOperation({ price: 41_500_000, compareAt: 48_000_000 }, op({ op: "set", value: 40_000_000, target: "compareAt" })),
    ).toEqual({ skip: "compare_below_price" });
  });

  it("target compareAt on a null compare-at: percent → unchanged, set → creates", () => {
    expect(applyOperation({ price: 10_000_000, compareAt: null }, op({ op: "percent", value: 10, target: "compareAt" }))).toEqual({
      skip: "unchanged",
    });
    expect(applyOperation({ price: 10_000_000, compareAt: null }, op({ op: "set", value: 12_000_000, target: "compareAt" }))).toEqual({
      after: { price: 10_000_000, compareAt: 12_000_000 },
      saleEnded: false,
    });
  });

  it("identical result → skip unchanged", () => {
    expect(applyOperation({ price: 10_000_000, compareAt: null }, op({ op: "set", value: 10_000_000 }))).toEqual({
      skip: "unchanged",
    });
  });
});

describe.skipIf(!hasTestDb())("catalog/bulk-price — bulkPrice (integration)", () => {
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

  async function product(over: Partial<typeof products.$inferInsert> = {}): Promise<number> {
    const rows = await handle.db
      .insert(products)
      .values({ slug: `bp-${ulid().toLowerCase()}`, name: "کالا", displayName: "کالا", status: "active", visibility: "public", price: 10_000_000, stockQty: 1, ...over })
      .returning({ id: products.id });
    return rows[0]?.id ?? 0;
  }

  it("apply writes price_history per row, one audit row, and cache.revalidate + cdn.purge jobs", async () => {
    const a = await product();
    const b = await product({ price: 20_000_000 });
    const actor = await staffActor(handle.db);
    const res = await bulkPrice(handle.db, { scope: { kind: "selection", ids: [a, b] }, op: { kind: "percent", value: 10 }, applyTo: "price" }, actor, false);
    expect(res).toMatchObject({ dryRun: false, updated: 2, skipped: 0 });
    if (res.dryRun) throw new Error("expected an apply result");
    expect(res.jobIds).toHaveLength(2);
    const rows = await handle.db.select({ id: products.id, price: products.price }).from(products).where(inArray(products.id, [a, b]));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.price]))).toEqual({ [a]: 11_000_000, [b]: 22_000_000 });
    const history = await handle.db.select().from(priceHistory).where(inArray(priceHistory.productId, [a, b]));
    expect(history).toHaveLength(2);
    const audit = (await handle.db.select().from(auditLog)).filter((r) => r.action === "catalog.price.bulk");
    expect(audit).toHaveLength(1);
    const jobs = await handle.db.select().from(jobsTable);
    expect(jobs.filter((j) => j.type === "cache.revalidate")).toHaveLength(1);
    expect(jobs.filter((j) => j.type === "cdn.purge")).toHaveLength(1);
  });

  it("rejects stale previews atomically and prevents a second application", async () => {
    const a = await product();
    const b = await product();
    const actor = await staffActor(handle.db);
    const input = { scope: { kind: "selection" as const, ids: [a, b] }, op: { kind: "percent" as const, value: 10 }, applyTo: "price" as const,
      expected: [a, b].map((id) => ({ id, price: 10_000_000, compareAt: null })) };
    await handle.db.update(products).set({ price: 12_000_000 }).where(eq(products.id, b));
    await expect(bulkPrice(handle.db, input, actor, false)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await handle.db.select().from(products).where(eq(products.id, a)))[0]?.price).toBe(10_000_000);
    expect(await handle.db.select().from(priceHistory)).toHaveLength(0);
    await handle.db.update(products).set({ price: 10_000_000 }).where(eq(products.id, b));
    await expect(bulkPrice(handle.db, input, actor, false)).resolves.toMatchObject({ updated: 2 });
    await expect(bulkPrice(handle.db, input, actor, false)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await handle.db.select().from(priceHistory)).toHaveLength(2);
  });

  it("rejects a preview when a selected product becomes archived", async () => {
    const a = await product();
    const actor = await staffActor(handle.db);
    await handle.db.update(products).set({ status: "archived" }).where(eq(products.id, a));
    await expect(bulkPrice(handle.db, { scope: { kind: "selection", ids: [a] }, op: { kind: "fixed", value: 100 }, applyTo: "price",
      expected: [{ id: a, price: 10_000_000, compareAt: null }] }, actor, false)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await handle.db.select().from(priceHistory)).toHaveLength(0);
  });

  it("fx rows are skipped; selection > 2000 → VALIDATION", async () => {
    const fx = await product({ priceBasis: "fx" });
    const plain = await product();
    const actor = await staffActor(handle.db);
    const preview = await bulkPrice(handle.db, { scope: { kind: "selection", ids: [fx, plain] }, op: { kind: "percent", value: 10 }, applyTo: "price" }, actor, true);
    expect(preview.dryRun).toBe(true);
    if (!preview.dryRun) throw new Error("expected a preview");
    expect(preview.count).toBe(1);
    expect(preview.rows.map((r) => r.id)).toEqual([plain]);
    expect(preview.skipped).toEqual([{ id: fx, displayName: "کالا", reason: "fx_basis" }]);
    expect((await handle.db.select({ price: products.price }).from(products).where(eq(products.id, fx)))[0]?.price).toBe(10_000_000);
    await expect(
      bulkPrice(handle.db, { scope: { kind: "selection", ids: Array.from({ length: 2_001 }, (_, i) => i + 1) }, op: { kind: "percent", value: 10 }, applyTo: "price" }, actor, true),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
