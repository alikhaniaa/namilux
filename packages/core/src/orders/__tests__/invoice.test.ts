import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { SETTINGS, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { assignInvoiceNo, formatInvoiceNo, invoiceView, jalaliYear } from "../invoice";
import { nextInvoiceNo } from "../repo";

describe("invoice - pure", () => {
  it("sequence restarts at 1 Farvardin Tehran midnight", () => {
    // 1 Farvardin 1405 is 21 March 2026; Tehran midnight is 20:30 UTC the evening before.
    expect(jalaliYear(new Date("2026-03-20T20:29:00Z"))).toBe(1404);
    expect(jalaliYear(new Date("2026-03-20T20:31:00Z"))).toBe(1405);
    expect(jalaliYear(new Date("2026-08-28T10:00:00Z"))).toBe(1405);
  });

  it("formatInvoiceNo uses Persian digits", () => {
    expect(formatInvoiceNo(1405, 123)).toBe("۱۴۰۵-۰۰۰۱۲۳");
    expect(formatInvoiceNo(1405, 1)).not.toMatch(/[0-9]/);
  });
});

describe.skipIf(!hasTestDb())("invoice — integration", () => {
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

  it("assignInvoiceNo is idempotent", async () => {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const order = await paidOrder(handle.db, { productId: seed.productId, customerId: seed.customerId }, actor);
    const paidAt = new Date(order.paidAt ?? Date.now());
    const first = await assignInvoiceNo(handle.db, order.id, paidAt);
    const second = await assignInvoiceNo(handle.db, order.id, paidAt);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(first);
  });

  it("numbers are gapless under concurrency", async () => {
    const got = await Promise.all(Array.from({ length: 8 }, () => nextInvoiceNo(handle.db, 1405)));
    const sorted = [...got].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 8 }, (_, i) => (sorted[0] ?? 0) + i));
    // a new Jalali year starts its own sequence at 1
    expect(await nextInvoiceNo(handle.db, 1406)).toBe(1);
  });

  it("VAT-inclusive breakdown is correct", async () => {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const order = await paidOrder(handle.db, { productId: seed.productId, customerId: seed.customerId, unitPriceOverride: 1_100_000 }, actor);
    const view = await invoiceView(handle.db, order.id, { settings: { ...SETTINGS, "commerce.vat_percent": 10 } });
    expect(view.grandTotal).toBe(order.grandTotal);
    expect(view.vat).toBe(Math.round(order.grandTotal - order.grandTotal / 1.1));
    expect(view.lines[0]?.vat).toBe(Math.round(1_100_000 - 1_100_000 / 1.1));
    expect(view.invoiceNo).not.toMatch(/[0-9]/);
    const noVat = await invoiceView(handle.db, order.id, { settings: { ...SETTINGS, "commerce.vat_percent": 0 } });
    expect(noVat.vat).toBe(0);
    expect(noVat.lines[0]?.vat).toBe(0);
  });
});
