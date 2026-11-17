import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { SETTINGS, paidOrder, pendingOrder, staffActor } from "../../__tests__/support/fixtures";
import { orderCode } from "../../ids";
import type * as Ids from "../../ids";
import type { Actor } from "../../types";
import { cancelByStaff } from "../admin";
import { findByCode, listAdmin, nextInvoiceNo, salesStats, updateOrder, updateStatus } from "../repo";

vi.mock("../../ids", async (importOriginal) => {
  const real = await importOriginal<typeof Ids>();
  return { ...real, orderCode: vi.fn(real.orderCode) };
});
const REAL = vi.hoisted(() => ({ orderCode: undefined as undefined | (() => string) }));

describe.skipIf(!hasTestDb())("orders repo", () => {
  let handle: TestDb;
  let actor: Actor;
  let productId: number;
  let customerId: string;

  beforeAll(async () => {
    handle = await createTestDb();
    REAL.orderCode = (await vi.importActual<typeof Ids>("../../ids")).orderCode;
  });
  afterEach(async () => {
    vi.mocked(orderCode).mockReset();
    vi.mocked(orderCode).mockImplementation(() => REAL.orderCode?.() ?? "NL-00000");
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function seed(): Promise<void> {
    const s = await seedMinimal(handle.db);
    productId = s.productId;
    customerId = s.customerId;
    actor = await staffActor(handle.db);
  }

  it("order code collision retries with a new code", async () => {
    await seed();
    const real = REAL.orderCode ?? (() => "NL-00000");
    vi.mocked(orderCode).mockReturnValueOnce("NL-ZZZZ1").mockReturnValueOnce("NL-ZZZZ1").mockImplementation(real);
    const a = await pendingOrder(handle.db, { productId, customerId }, actor);
    const b = await pendingOrder(handle.db, { productId, customerId }, actor);
    expect(a.code).toBe("NL-ZZZZ1");
    expect(b.code).not.toBe("NL-ZZZZ1");
    expect(vi.mocked(orderCode).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(await findByCode(handle.db, b.code)).not.toBeNull();
  });

  it("updateStatus is optimistic on the from-status", async () => {
    await seed();
    const o = await pendingOrder(handle.db, { productId, customerId }, actor);
    expect(await updateStatus(handle.db, o.id, "paid", "processing", {})).toBe(false);
    expect(await updateStatus(handle.db, o.id, "pending_payment", "cancelled", {})).toBe(true);
    expect((await findByCode(handle.db, o.code))?.status).toBe("cancelled");
    expect(await updateStatus(handle.db, o.id, "pending_payment", "cancelled", {})).toBe(false);
  });

  it("listAdmin applies every filter in the spec", async () => {
    await seed();
    const paid = await paidOrder(handle.db, { productId, customerId }, actor);
    const pending = await pendingOrder(handle.db, { productId, customerId }, actor);
    await updateOrder(handle.db, paid.id, { adminNote: "تماس گرفته شد" });
    const base = { page: 1, pageSize: 50 as const };
    expect((await listAdmin(handle.db, base)).total).toBe(2);
    expect((await listAdmin(handle.db, { ...base, status: ["paid"] })).items.map((r) => r.code)).toEqual([paid.code]);
    expect((await listAdmin(handle.db, { ...base, status: ["pending_payment"] })).items.map((r) => r.code)).toEqual([pending.code]);
    expect((await listAdmin(handle.db, { ...base, source: ["phone"] })).total).toBe(2);
    expect((await listAdmin(handle.db, { ...base, source: ["web"] })).total).toBe(0);
    expect((await listAdmin(handle.db, { ...base, q: paid.code })).items.map((r) => r.code)).toEqual([paid.code]);
    expect((await listAdmin(handle.db, { ...base, customerId })).total).toBe(2);
    expect((await listAdmin(handle.db, { ...base, hasNote: true })).items.map((r) => r.code)).toEqual([paid.code]);
    expect((await listAdmin(handle.db, { ...base, province: "THR" })).total).toBe(2);
    expect((await listAdmin(handle.db, { ...base, province: "ESF" })).total).toBe(0);
    expect((await listAdmin(handle.db, { ...base, shippingMethodKey: "free_nationwide" })).total).toBe(2);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    expect((await listAdmin(handle.db, { ...base, from, to })).total).toBe(2);
    expect((await listAdmin(handle.db, { ...base, from: to })).total).toBe(0);
    const asc = await listAdmin(handle.db, { ...base, sort: "placed_asc" });
    expect(asc.items[0]?.code).toBe(paid.code);
    const desc = await listAdmin(handle.db, { ...base, sort: "placed_desc" });
    expect(desc.items[0]?.code).toBe(pending.code);
  });

  it("nextInvoiceNo is gapless per year under concurrency", async () => {
    const got = await Promise.all(Array.from({ length: 6 }, () => nextInvoiceNo(handle.db, 1405)));
    expect([...got].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await nextInvoiceNo(handle.db, 1404)).toBe(1);
  });

  it("salesStats excludes refunded and cancelled", async () => {
    await seed();
    const kept = await paidOrder(handle.db, { productId, customerId }, actor);
    const gone = await paidOrder(handle.db, { productId, customerId }, actor);
    await cancelByStaff(handle.db, gone.id, "اشتباه ثبت شده", true, actor, { settings: SETTINGS });
    const stats = await salesStats(handle.db, { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 3_600_000).toISOString() });
    expect(stats.orders).toBe(1);
    expect(stats.revenue).toBe(kept.grandTotal);
    expect(stats.aov).toBe(kept.grandTotal);
    expect(stats.byStatus.cancelled).toBe(1);
  });
});
