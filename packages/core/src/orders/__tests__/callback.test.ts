import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { and, customers, eq, jobs as jobsTable, orderEvents as orderEventsTable, orders, securityEvents, sql } from "@namilux/db";
import { ulid } from "../../ids";
import { DEFAULT_SETTINGS } from "../../settings/schema";
import { closeAbandonedAttempt, handleCallback, resultRedirect } from "../callback";
import type { PaymentDriver } from "../payments";
import { findByCode, lockForUpdate, payments as paymentsRepo } from "../repo";
import { orderState } from "../state";

function driver(verifyImpl: PaymentDriver["verify"]): PaymentDriver {
  return { key: "mock", async request() { return { ok: false, error: "n/a" }; }, verify: verifyImpl };
}

describe.skipIf(!hasTestDb())("orders/callback — integration", () => {
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

  let phoneSeq = 0;
  async function seedOrder(grandTotal: number, refId: string | null = null, paymentDriver: PaymentDriver["key"] = "mock"): Promise<{ code: string; id: string; authority: string; paymentId: string }> {
    const id = ulid();
    const code = `NL-${ulid().slice(-5)}`;
    const custId = ulid();
    // 11-digit 09xxxxxxxxx, always full-length and unique per call (the raw `Date.now() % 9e6` was
    // neither zero-padded - 10-digit phones failed customers_phone_format - nor collision-free).
    const phone = `0912${String(1_000_000 + phoneSeq++).slice(-7)}`;
    await handle.db.insert(customers).values({ id: custId, phone, referralCode: ulid().slice(-8) });
    await handle.db.insert(orders).values({ id, code, phone: "09121110000", customerId: custId, status: "pending_payment", subtotal: grandTotal, grandTotal, placedAt: new Date() });
    const authority = `AUTH-${ulid().slice(-8)}`;
    const payment = await paymentsRepo.insert(handle.db, { orderId: id, driver: paymentDriver, amount: grandTotal, status: "redirected", authority, refId, cardPanMasked: null, fee: null });
    return { code, id, authority, paymentId: payment.id };
  }

  const ctx = (d: PaymentDriver) => ({ drivers: { payment: () => d }, settings: DEFAULT_SETTINGS, ip: "1.2.3.4" });

  it("forged/unknown authority → generic fail + security event", async () => {
    const okDriver = driver(async () => ({ ok: true, refId: "R", alreadyVerified: false }));
    const res = await handleCallback(handle.db, "mock", { Authority: "DOES-NOT-EXIST", Status: "OK" }, ctx(okDriver));
    expect(res).toMatchObject({ ok: false, orderCode: "" });
    const [n] = await handle.db.select({ c: sql<number>`count(*)::int` }).from(securityEvents).where(eq(securityEvents.kind, "callback.forged"));
    expect(n!.c).toBe(1);
  });

  it("Status NOK → order failed, ok:false", async () => {
    const { code, authority } = await seedOrder(5_000_000);
    const okDriver = driver(async () => ({ ok: true, refId: "R", alreadyVerified: false }));
    const res = await handleCallback(handle.db, "mock", { Authority: authority, Status: "NOK" }, ctx(okDriver));
    expect(res).toMatchObject({ ok: false, orderCode: code });
    const order = await findByCode(handle.db, code);
    expect(order?.status).toBe("failed");
  });

  it("Status OK + verify 100 → order paid once; verify uses the STORED amount", async () => {
    const { code, authority } = await seedOrder(5_000_000);
    const verify = vi.fn(async () => ({ ok: true as const, refId: "REF9", cardPan: "6037991122334455", fee: 0, alreadyVerified: false }));
    const res = await handleCallback(handle.db, "mock", { Authority: authority, Status: "OK" }, ctx({ key: "mock", async request() { return { ok: false, error: "n/a" }; }, verify }));
    expect(res).toMatchObject({ ok: true, orderCode: code, test: true });
    expect(verify).toHaveBeenCalledWith({ amount: 5_000_000, authority }); // stored amount, not a param
    const order = await findByCode(handle.db, code);
    expect(order?.status).toBe("paid");

    // Replay: the order is already paid → idempotent success, no re-verify side effects.
    const replay = await handleCallback(handle.db, "mock", { Authority: authority, Status: "OK" }, ctx({ key: "mock", async request() { return { ok: false, error: "n/a" }; }, verify }));
    expect(replay.ok).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - two-phase (SnappPay): verify HOLDS, settle takes

  /**
   * The instalment gateway's shape: `parseCallback` reads its own field names, `verify` reports the
   * hold with needsSettle, and every later call is keyed on the paymentToken stored in ref_id.
   */
  function twoPhase(over: Partial<PaymentDriver> = {}): PaymentDriver {
    return {
      key: "mock",
      async request() { return { ok: false, error: "n/a" }; },
      parseCallback: (p) => ({ authority: p["transactionId"] ?? "", ok: p["state"] === "OK" }),
      async verify(o) { return { ok: true, refId: o.providerRef ?? "", alreadyVerified: false, needsSettle: true }; },
      async settle() { return { ok: true }; },
      async reverse() { return { ok: true }; },
      ...over,
    };
  }

  const eventTypes = async (orderId: string): Promise<string[]> => {
    const rows = await handle.db.select({ type: orderEventsTable.type }).from(orderEventsTable).where(eq(orderEventsTable.orderId, orderId));
    return rows.map((r) => r.type);
  };

  it("a POST callback is parsed by the driver, and a held payment settles inline", async () => {
    const { code, id, authority } = await seedOrder(5_000_000, "PT-1");
    const settle = vi.fn(async () => ({ ok: true }));
    const d = twoPhase({ settle });
    // The gateway's own field names - nothing here looks like ZarinPal's Authority/Status.
    const res = await handleCallback(handle.db, "mock", { transactionId: authority, state: "OK", amount: "50000000" }, ctx(d));
    expect(res).toMatchObject({ ok: true, orderCode: code });
    // settle is keyed on the paymentToken written to ref_id at redirect, not on the authority.
    expect(settle).toHaveBeenCalledWith({ authority, providerRef: "PT-1" });
    expect(await eventTypes(id)).toContain("payment.settled");
    expect((await findByCode(handle.db, code))?.status).toBe("paid");
    // A durable recovery job is written before external side effects; it becomes a no-op after success.
    const queued = await handle.db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.type, "payment.settle"));
    expect(queued).toHaveLength(1);
  });

  it("settlement failure stays pending, retains its recovery job, and never fulfils", async () => {
    const { code, id, authority, paymentId } = await seedOrder(5_000_000, "PT-2");
    const d = twoPhase({ settle: async () => ({ ok: false, error: "transport" }) });
    const res = await handleCallback(handle.db, "mock", { transactionId: authority, state: "OK" }, ctx(d));
    expect(res).toMatchObject({ ok: false, pending: true });
    expect((await findByCode(handle.db, code))?.status).toBe("pending_payment");
    const queued = await handle.db.select().from(jobsTable).where(and(eq(jobsTable.type, "payment.settle"), eq(jobsTable.uniqueKey, `payment.settle:${paymentId}`)));
    expect(queued).toHaveLength(1);
    expect(await eventTypes(id)).not.toContain("payment.succeeded");
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.verifiedAt).not.toBeNull();
    const recovered = await handleCallback(handle.db, "mock", { transactionId: authority, state: "OK" }, ctx(twoPhase()));
    expect(recovered.ok).toBe(true);
    expect((await findByCode(handle.db, code))?.status).toBe("paid");
  });

  it.each(["expired", "failed", "cancelled"] as const)("a SnappPay hold is reverted when the order becomes %s before settlement recovery", async (status) => {
    const { code, id, authority } = await seedOrder(5_000_000, "PT-REVERT", "snapppay");
    const settle = vi.fn(async () => ({ ok: false }));
    const reverse = vi.fn(async () => ({ ok: true }));
    const d = twoPhase({ key: "snapppay", settle, reverse });
    const params = { transactionId: authority, state: "OK" };
    expect(await handleCallback(handle.db, "snapppay", params, ctx(d))).toMatchObject({ pending: true });
    await orderState.transition(handle.db, id, status, { actor: { type: "system", id: null }, settings: DEFAULT_SETTINGS });
    const result = await handleCallback(handle.db, "snapppay", params, ctx(d));
    expect(result).toMatchObject({ ok: false, pending: false });
    expect(reverse).toHaveBeenCalledExactlyOnceWith({ authority, providerRef: "PT-REVERT" });
    expect(settle).toHaveBeenCalledTimes(1);
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("failed");
    expect((await findByCode(handle.db, code))?.status).toBe(status);
    expect(await eventTypes(id)).toContain("payment.reversed");
    expect(await eventTypes(id)).not.toContain("payment.succeeded");
  });

  it("an unresolved revert stays recoverable until a later attempt succeeds", async () => {
    const { id, authority } = await seedOrder(5_000_000, "PT-RETRY", "snapppay");
    await orderState.transition(handle.db, id, "expired", { actor: { type: "system", id: null }, settings: DEFAULT_SETTINGS });
    const settle = vi.fn(async () => ({ ok: true }));
    const reverse = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue({ ok: true });
    const d = twoPhase({ key: "snapppay", settle, reverse });
    const params = { transactionId: authority, state: "OK" };
    expect(await handleCallback(handle.db, "snapppay", params, ctx(d))).toMatchObject({ ok: false, pending: true });
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("redirected");
    const queued = await handle.db.select().from(jobsTable).where(eq(jobsTable.type, "payment.settle"));
    expect(queued).toHaveLength(1);
    expect(await handleCallback(handle.db, "snapppay", params, ctx(d))).toMatchObject({ ok: false, pending: false });
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("failed");
    expect(settle).not.toHaveBeenCalled();
  });

  it("a callback replay after a full refund never verifies or settles again", async () => {
    const { id, authority } = await seedOrder(5_000_000, "PT-REFUNDED", "snapppay");
    const d = twoPhase({ key: "snapppay" });
    const params = { transactionId: authority, state: "OK" };
    await handleCallback(handle.db, "snapppay", params, ctx(d));
    await orderState.transition(handle.db, id, "refunded", { actor: { type: "system", id: null }, settings: DEFAULT_SETTINGS });
    const verify = vi.fn(d.verify.bind(d));
    const settle = vi.fn(async () => ({ ok: true }));
    expect(await handleCallback(handle.db, "snapppay", params, ctx(twoPhase({ key: "snapppay", verify, settle })))).toMatchObject({ ok: false });
    expect(verify).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it.each(["failed", "expired"] as const)("a closed %s token cannot fail or fulfil a new attempt", async (status) => {
    const { id, code, authority, paymentId } = await seedOrder(5_000_000, "PT-OLD", "snapppay");
    await paymentsRepo.update(handle.db, paymentId, { status });
    const next = await paymentsRepo.insert(handle.db, { orderId: id, driver: "snapppay", amount: 5_000_000, status: "redirected", authority: `NEW-${ulid()}`, refId: "PT-NEW", cardPanMasked: null, fee: null });
    const verify = vi.fn<PaymentDriver["verify"]>(async () => ({ ok: false }));
    const reverse = vi.fn(async () => ({ ok: true }));
    const d = twoPhase({ key: "snapppay", verify, reverse, inquiry: async () => ({ ok: true, status: "CANCEL" }) });
    for (const state of ["FAILED", "OK"]) {
      expect(await handleCallback(handle.db, "snapppay", { transactionId: authority, state }, ctx(d))).toMatchObject({ ok: false });
    }
    expect(verify).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
    expect((await findByCode(handle.db, code))?.status).toBe("pending_payment");
    expect((await paymentsRepo.findByAuthority(handle.db, next.authority!))?.status).toBe("redirected");
    expect(await handle.db.select().from(jobsTable).where(eq(jobsTable.uniqueKey, `payment.settle:${paymentId}`))).toHaveLength(0);
    expect(await handleCallback(handle.db, "snapppay", { transactionId: next.authority!, state: "OK" }, ctx(twoPhase({ key: "snapppay" })))).toMatchObject({ ok: true });
  });

  it("browser-supplied failure cannot cancel a payment that the gateway verifies", async () => {
    const { code, authority } = await seedOrder(5_000_000, "PT-3");
    const reverse = vi.fn(async () => ({ ok: true }));
    const res = await handleCallback(handle.db, "mock", { transactionId: authority, state: "FAILED" }, ctx(twoPhase({ reverse })));
    expect(res.ok).toBe(true);
    expect(reverse).not.toHaveBeenCalled();
    expect((await findByCode(handle.db, code))?.status).toBe("paid");
  });

  it("uncertain verification stays pending without reversing credit", async () => {
    const { code, authority } = await seedOrder(5_000_000, "PT-4");
    const reverse = vi.fn(async () => ({ ok: true }));
    const d = twoPhase({ reverse, verify: async () => ({ ok: false, error: "transport" }) });
    const res = await handleCallback(handle.db, "mock", { transactionId: authority, state: "OK" }, ctx(d));
    expect(res).toMatchObject({ ok: false, pending: true });
    expect(reverse).not.toHaveBeenCalled();
    expect((await findByCode(handle.db, code))?.status).toBe("pending_payment");
  });

  it.each(["unknown", "VERIFY", "SETTLE"] as const)("a FAILED callback keeps %s gateway state recoverable", async (status) => {
    const { code, authority, paymentId } = await seedOrder(5_000_000, "PT-UNCERTAIN", "snapppay");
    const reverse = vi.fn(async () => ({ ok: false }));
    const d = twoPhase({
      key: "snapppay",
      verify: async () => ({ ok: false, error: "transport" }),
      inquiry: async () => status === "unknown" ? { ok: false } : { ok: true, status },
      reverse,
    });
    const result = await handleCallback(handle.db, "snapppay", { transactionId: authority, state: "FAILED" }, ctx(d));
    expect(result).toMatchObject({ ok: false, pending: true });
    expect(reverse).not.toHaveBeenCalled();
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("redirected");
    expect((await findByCode(handle.db, code))?.status).toBe("pending_payment");
    const queued = await handle.db.select().from(jobsTable).where(eq(jobsTable.uniqueKey, `payment.settle:${paymentId}`));
    expect(queued).toHaveLength(1);
    if (status !== "unknown") expect((await paymentsRepo.findByAuthority(handle.db, authority))?.verifiedAt).not.toBeNull();
    // The durable retry can complete without the shopper having to pay a second time.
    const recovered = await handleCallback(handle.db, "snapppay", { transactionId: authority, state: "OK" }, ctx(twoPhase({ key: "snapppay" })));
    expect(recovered.ok).toBe(true);
    expect((await findByCode(handle.db, code))?.status).toBe("paid");
  });

  it.each([false, true])("a FAILED pending callback closes only after a confirmed revert (success=%s)", async (ok) => {
    const { code, authority } = await seedOrder(5_000_000, "PT-PENDING", "snapppay");
    const d = twoPhase({
      key: "snapppay",
      verify: async () => ({ ok: false, error: "not verified" }),
      inquiry: async () => ({ ok: true, status: "PENDING" }),
      reverse: async () => ({ ok }),
    });
    const result = await handleCallback(handle.db, "snapppay", { transactionId: authority, state: "FAILED" }, ctx(d));
    expect(result).toMatchObject({ ok: false, pending: !ok });
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe(ok ? "failed" : "redirected");
    expect((await findByCode(handle.db, code))?.status).toBe(ok ? "failed" : "pending_payment");
  });

  it("abandoned cleanup reloads a stale payment after a successful callback", async () => {
    const { code, authority } = await seedOrder(5_000_000, "PT-CLEANUP", "snapppay");
    const stale = (await paymentsRepo.findByAuthority(handle.db, authority))!;
    const inquiry = vi.fn(async () => ({ ok: true, status: "PENDING" }));
    const reverse = vi.fn(async () => ({ ok: false }));
    const d = twoPhase({ key: "snapppay", inquiry, reverse });
    await handleCallback(handle.db, "snapppay", { transactionId: authority, state: "OK" }, ctx(d));
    expect(await closeAbandonedAttempt(handle.db, d, stale)).toBe("open");
    expect(inquiry).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("succeeded");
    expect((await findByCode(handle.db, code))?.status).toBe("paid");
  });

  it("abandoned cleanup waits for a concurrent callback's order lock", async () => {
    const { id, authority } = await seedOrder(5_000_000, "PT-LOCK", "snapppay");
    const stale = (await paymentsRepo.findByAuthority(handle.db, authority))!;
    let signalLocked = (): void => {};
    let finishCallback = (): void => {};
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const proceed = new Promise<void>((resolve) => { finishCallback = resolve; });
    const callback = handle.db.transaction(async (tx) => {
      await lockForUpdate(tx, id);
      signalLocked();
      await proceed;
      return handleCallback(tx, "snapppay", { transactionId: authority, state: "OK" }, ctx(twoPhase({ key: "snapppay" })));
    });
    await locked;
    const inquiry = vi.fn(async () => ({ ok: true, status: "PENDING" }));
    const reverse = vi.fn(async () => {
      // If cleanup misses the lock, its revert response arrives after the callback committed.
      await callback;
      return { ok: false };
    });
    const cleanup = closeAbandonedAttempt(handle.db, twoPhase({ key: "snapppay", inquiry, reverse }), stale);
    finishCallback();
    const [paid, result] = await Promise.all([callback, cleanup]);
    expect(paid.ok).toBe(true);
    expect(result).toBe("open");
    expect(inquiry).not.toHaveBeenCalled();
    expect(reverse).not.toHaveBeenCalled();
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe("succeeded");
  });

  it.each(["unknown", "PENDING", "VERIFY", "SETTLE", "REVERT", "CANCEL"] as const)("cleanup reconciles %s after a revert loses its response", async (status) => {
    const { authority } = await seedOrder(5_000_000, "PT-REVERT-LOST", "snapppay");
    const payment = (await paymentsRepo.findByAuthority(handle.db, authority))!;
    const inquiry = vi.fn<NonNullable<PaymentDriver["inquiry"]>>()
      .mockResolvedValueOnce({ ok: true, status: "PENDING" })
      .mockResolvedValue(status === "unknown" ? { ok: false } : { ok: true, status });
    const d = twoPhase({ key: "snapppay", inquiry, reverse: async () => { throw new Error("timeout"); } });
    const closed = status === "REVERT" || status === "CANCEL";
    const open = status === "VERIFY" || status === "SETTLE";
    expect(await closeAbandonedAttempt(handle.db, d, payment)).toBe(closed ? "closed" : open ? "open" : "unknown");
    expect((await paymentsRepo.findByAuthority(handle.db, authority))?.status).toBe(closed ? "expired" : "redirected");
  });

  it("concurrent callbacks settle and fulfil only once", async () => {
    const { id, authority } = await seedOrder(5_000_000, "PT-RACE");
    const settle = vi.fn(async () => ({ ok: true }));
    const d = twoPhase({ settle });
    const results = await Promise.all([1, 2].map(() => handleCallback(handle.db, "mock", { transactionId: authority, state: "OK" }, ctx(d))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(settle).toHaveBeenCalledTimes(1);
    expect((await eventTypes(id)).filter((e) => e === "payment.succeeded")).toHaveLength(1);
  });

  it("a callback for the wrong driver cannot verify another driver's authority", async () => {
    const { authority } = await seedOrder(5_000_000);
    const verify = vi.fn(async () => ({ ok: true as const, refId: "R", alreadyVerified: false }));
    const res = await handleCallback(handle.db, "zarinpal", { Authority: authority, Status: "OK" }, ctx(driver(verify)));
    expect(res).toMatchObject({ ok: false, orderCode: "" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("a one-phase gateway is never asked to reverse a failed callback", async () => {
    // ZarinPal's reverse undoes a *successful* charge inside 30 minutes; firing it on every NOK
    // would be useless and noisy. `settle` is what marks a driver as holding rather than capturing.
    const { code, id, authority } = await seedOrder(5_000_000);
    const reverse = vi.fn(async () => ({ ok: true }));
    const d: PaymentDriver = { ...driver(async () => ({ ok: true, refId: "R", alreadyVerified: false })), reverse };
    await handleCallback(handle.db, "mock", { Authority: authority, Status: "NOK" }, ctx(d));
    expect(reverse).not.toHaveBeenCalled();
    expect(await eventTypes(id)).not.toContain("payment.reversed");
    expect((await findByCode(handle.db, code))?.status).toBe("failed");
  });

  it("a ZarinPal replay without ref_id keeps the reference the first verify stored", async () => {
    // Code 101 answers a replayed verify and may omit ref_id, which the driver reports as "".
    // Overwriting with that would lose the only handle a refund has.
    const { authority, paymentId } = await seedOrder(5_000_000, "REF-FIRST");
    const d = driver(async () => ({ ok: true, refId: "", alreadyVerified: true }));
    await handleCallback(handle.db, "mock", { Authority: authority, Status: "OK" }, ctx(d));
    const row = (await paymentsRepo.findByAuthority(handle.db, authority));
    expect(row?.status).toBe("succeeded");
    expect(row?.refId).toBe("REF-FIRST");
    expect(row?.id).toBe(paymentId);
  });

  it("resultRedirect builds the noindex result URL", () => {
    expect(resultRedirect({ orderCode: "NL-ABCDE", ok: true, test: false }, "https://namilux.ir")).toBe("https://namilux.ir/billing/result/?o=NL-ABCDE&s=ok");
    expect(resultRedirect({ orderCode: "NL-ABCDE", ok: false, test: false }, "https://namilux.ir")).toBe("https://namilux.ir/billing/result/?o=NL-ABCDE&s=fail");
  });
});
