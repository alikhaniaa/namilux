import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, truncateAll, type TestDb } from "@namilux/db/test";
import { auditLog, eq, jobs as jobsTable, priceHistory, products } from "@namilux/db";
import { staffActor } from "../../__tests__/support/fixtures";
import { jobs } from "../../jobs";
import { deriveInstalmentPrice, instalmentsRule } from "../../pricing/instalments";
import { getSettings } from "../../settings/service";
import { ulid } from "../../ids";
import { PRICE_EDIT_MAX, PRICE_SHEET_MAX, priceEditSchema, priceSheetSchema } from "../../validation/price-sheet";
import { listPriceChanges, listPriceSheet, savePriceSheet } from "../price-sheet";

const before = { price: 1_000_000, compareAtPrice: 1_200_000 };
const after = { price: 1_001_000, compareAtPrice: 1_201_000 };
const row = { id: 1, before, after };

describe("price sheet validation", () => {
  it("requires unique, bounded selections and explicit original prices", () => {
    expect(priceSheetSchema.safeParse({ rows: [row] }).success).toBe(true);
    for (const rows of [[], [row, row], [{ id: 1, after }], Array.from({ length: 2001 }, (_, i) => ({ ...row, id: i + 1 }))]) {
      expect(priceSheetSchema.safeParse({ rows }).success).toBe(false);
    }
  });
  it("rejects invalid money and discount relationships, but accepts clearing a price or discount", () => {
    for (const price of [-1, 0.5, Infinity, NaN, 10_000_000_000_001, "", "1000"]) {
      expect(priceSheetSchema.safeParse({ rows: [{ ...row, after: { price, compareAtPrice: null } }] }).success).toBe(false);
    }
    for (const p of [{ price: 0, compareAtPrice: 100 }, { price: 100, compareAtPrice: 100 }, { price: 100, compareAtPrice: 90 }]) {
      expect(priceSheetSchema.safeParse({ rows: [{ ...row, after: p }] }).success).toBe(false);
    }
    expect(priceSheetSchema.safeParse({ rows: [{ ...row, after: { price: 0, compareAtPrice: null } }] }).success).toBe(true);
  });
  it("caps a hand edit at what a person types at once, with the same rules per row", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row, id: i + 1 }));
    expect(priceEditSchema.safeParse({ rows: many(PRICE_EDIT_MAX), note: "برگشت به قیمت قبلی" }).success).toBe(true);
    expect(priceEditSchema.safeParse({ rows: many(PRICE_EDIT_MAX + 1) }).success).toBe(false);
    expect(priceEditSchema.safeParse({ rows: [row, row] }).success).toBe(false);
    expect(priceEditSchema.safeParse({ rows: [{ ...row, after: { price: 100, compareAtPrice: 90 } }] }).success).toBe(false);
    expect(priceSheetSchema.safeParse({ rows: many(PRICE_SHEET_MAX) }).success).toBe(true);
  });
});

describe.skipIf(!hasTestDb())("price sheet database", () => {
  let handle: TestDb;
  beforeAll(async () => { handle = await createTestDb(); });
  afterEach(async () => { vi.restoreAllMocks(); await truncateAll(handle.db); });
  afterAll(async () => { await handle.close(); });
  async function product(overrides: Partial<typeof products.$inferInsert> = {}) {
    const [p] = await handle.db.insert(products).values({ slug: `sheet-${ulid().toLowerCase()}`, name: "کالا", displayName: "کالا", status: "active", ...before, ...overrides }).returning();
    if (p === undefined) throw new Error("missing fixture");
    return p;
  }
  it("raises every product by 1,000 Toman and restores exact selling, discount and instalment prices", async () => {
    const actor = await staffActor(handle.db);
    const rule = instalmentsRule(await getSettings(handle.db));
    for (let i = 0; i < 205; i++) {
      const price = before.price + i * 1000;
      await product({ price, compareAtPrice: 1_500_000, instalmentPrice: deriveInstalmentPrice(price, rule) });
    }
    const original = await handle.db.select().from(products).orderBy(products.id);
    const edits = original.map((p) => ({ id: p.id, before: { price: p.price, compareAtPrice: p.compareAtPrice }, after: { price: p.price + 1000, compareAtPrice: (p.compareAtPrice ?? 0) + 1000 } }));
    const result = await savePriceSheet(handle.db, { rows: edits, note: "roundtrip increase" }, actor);
    expect(result.updated).toBe(205);
    const raised = await listPriceSheet(handle.db);
    expect(raised.every((p) => p.price === (original.find((r) => r.id === p.id)?.price ?? 0) + 1000)).toBe(true);
    await savePriceSheet(handle.db, { rows: edits.map((r) => ({ id: r.id, before: r.after, after: r.before })), note: "roundtrip restore" }, actor);
    const restored = await handle.db.select().from(products).orderBy(products.id);
    expect(restored.map((p) => [p.id, p.price, p.compareAtPrice, p.instalmentPrice])).toEqual(original.map((p) => [p.id, p.price, p.compareAtPrice, p.instalmentPrice]));
    expect(await handle.db.select().from(priceHistory)).toHaveLength(410);
    expect(await handle.db.select().from(auditLog)).toHaveLength(2);
    expect((await handle.db.select().from(jobsTable)).map((j) => j.type).sort()).toEqual(["cache.revalidate", "cache.revalidate", "cdn.purge", "cdn.purge"]);
  });
  it("rejects stale selling or discount prices before writing any row", async () => {
    const actor = await staffActor(handle.db);
    const a = await product(); const b = await product();
    await handle.db.update(products).set({ compareAtPrice: 1_300_000 }).where(eq(products.id, b.id));
    await expect(savePriceSheet(handle.db, { rows: [{ ...row, id: a.id }, { ...row, id: b.id }] }, actor)).rejects.toMatchObject({ code: "CONFLICT", details: { ids: [b.id] } });
    expect((await handle.db.select().from(products).where(eq(products.id, a.id)))[0]?.price).toBe(before.price);
    expect(await handle.db.select().from(priceHistory)).toHaveLength(0);
  });
  it("rejects archived, missing and FX rows; includes separate variants and hidden products", async () => {
    const actor = await staffActor(handle.db);
    const archived = await product({ status: "archived" });
    const fx = await product({ priceBasis: "fx", baseCurrency: "USD", basePrice: "100.00" });
    const hidden = await product({ visibility: "hidden", modelCode: "VARIANT-B" });
    for (const id of [archived.id, fx.id, 999999]) {
      await expect(savePriceSheet(handle.db, { rows: [{ ...row, id }] }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect((await listPriceSheet(handle.db)).map((p) => p.id)).toEqual(expect.arrayContaining([fx.id, hidden.id]));
    expect((await listPriceSheet(handle.db)).some((p) => p.id === archived.id)).toBe(false);
  });
  it("rolls back prices, history and audit if cache enqueue fails", async () => {
    const actor = await staffActor(handle.db); const p = await product();
    vi.spyOn(jobs, "enqueue").mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(savePriceSheet(handle.db, { rows: [{ ...row, id: p.id }] }, actor)).rejects.toThrow("queue unavailable");
    expect((await handle.db.select().from(products))[0]?.price).toBe(before.price);
    expect(await handle.db.select().from(priceHistory)).toHaveLength(0);
    expect(await handle.db.select().from(auditLog)).toHaveLength(0);
  });
  it("lists what a repricer needs beside the number: last change, availability, a picture key", async () => {
    const actor = await staffActor(handle.db);
    const inStock = await product({ stockQty: 3 });
    const soldOut = await product({ stockQty: 0 });
    const free = await product({ stockPolicy: "untracked", stockQty: 0 });
    await savePriceSheet(handle.db, { rows: [{ ...row, id: inStock.id }] }, actor);
    const rows = new Map((await listPriceSheet(handle.db)).map((r) => [r.id, r]));
    expect(rows.get(inStock.id)).toMatchObject({ available: true, imageKey: null, price: after.price });
    expect(Date.parse(rows.get(inStock.id)?.priceUpdatedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(rows.get(soldOut.id)).toMatchObject({ available: false, priceUpdatedAt: null });
    expect(rows.get(free.id)?.available).toBe(true);
  });
  it("logs every change with the price it replaced, and offers to put back only the latest", async () => {
    const actor = await staffActor(handle.db);
    const a = await product({ displayName: "یخچال آلفا", sku: "ALFA-1" });
    const b = await product({ displayName: "اجاق بتا" });
    const since = new Date(Date.now() - 60_000);
    // a: two changes in a row; b: one change, then repriced outside the sheet
    await savePriceSheet(handle.db, { rows: [{ ...row, id: a.id }, { ...row, id: b.id }], note: "اول" }, actor);
    await savePriceSheet(handle.db, { rows: [{ id: a.id, before: after, after: { price: 1_500_000, compareAtPrice: null } }], note: "دوم" }, actor);
    await handle.db.update(products).set({ price: 999_000 }).where(eq(products.id, b.id));

    const { rows, more } = await listPriceChanges(handle.db, { since });
    expect(more).toBe(false);
    const ofA = rows.filter((r) => r.productId === a.id);
    // newest first; `before` of the first change is unknown, since nothing was logged ahead of it
    expect(ofA.map((r) => [r.note, r.before, r.after, r.revertible])).toEqual([
      ["دوم", after, { price: 1_500_000, compareAtPrice: null }, true],
      ["اول", null, after, false],
    ]);
    expect(ofA[0]).toMatchObject({ displayName: "یخچال آلفا", code: "ALFA-1", actorType: "staff" });
    expect(typeof ofA[0]?.actorName).toBe("string");
    // the logged price of b is no longer the stored one, so the log does not offer to put it back
    expect(rows.find((r) => r.productId === b.id)?.revertible).toBe(false);

    expect((await listPriceChanges(handle.db, { since, q: "آلفا" })).rows.every((r) => r.productId === a.id)).toBe(true);
    expect((await listPriceChanges(handle.db, { since, q: "alfa-1" })).rows).toHaveLength(2);
    expect((await listPriceChanges(handle.db, { since, q: "100%" })).rows).toHaveLength(0);
    expect((await listPriceChanges(handle.db, { since: new Date(Date.now() + 60_000) })).rows).toHaveLength(0);
  });
  it("preserves manually pinned instalment prices and skips unchanged rows", async () => {
    const actor = await staffActor(handle.db); const p = await product({ instalmentPriceManual: true, instalmentPrice: 2_000_000 });
    expect((await savePriceSheet(handle.db, { rows: [{ id: p.id, before, after: before }] }, actor)).updated).toBe(0);
    await savePriceSheet(handle.db, { rows: [{ ...row, id: p.id }] }, actor);
    expect((await handle.db.select().from(products))[0]?.instalmentPrice).toBe(2_000_000);
    expect(await handle.db.select().from(priceHistory)).toHaveLength(1);
  });
});
