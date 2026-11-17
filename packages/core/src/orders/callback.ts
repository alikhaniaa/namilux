import { sql, type Db } from "@namilux/db";
import type { PaymentDriverKey } from "../constants";
import { jobs } from "../jobs";
import { security } from "../security";
import type { Settings } from "../settings/schema";
import type { CallbackResult, Payment } from "../types";
import { maskPan, refIdAfterVerify } from "./payments";
import type { PaymentDriver } from "./payments";
import { orderEvents } from "./events";
import { findById, lockForUpdate, payments as paymentsRepo } from "./repo";
import { orderState } from "./state";

const SYSTEM = { type: "system" as const, id: null };

/**
 * ZarinPal returns the shopper with `?Authority=…&Status=OK|NOK`; SnappPay POSTs a form with
 * `transactionId` + `state=OK|FAILED`. A driver that does not match ZarinPal's shape supplies
 * `parseCallback`, so this module stays gateway-agnostic.
 */
function readParams(driver: PaymentDriver | null, params: Record<string, string>): { authority: string; ok: boolean } {
  if (driver?.parseCallback !== undefined) return driver.parseCallback(params);
  const authority = params["Authority"] ?? params["authority"] ?? "";
  const status = params["Status"] ?? params["status"] ?? "";
  return { authority, ok: status === "OK" || status === "ok" };
}

/** Serialize callbacks with fulfilment/expiry; persist recovery before touching the gateway. */
export async function handleCallback(
  db: Db, driverKey: PaymentDriverKey, params: Record<string, string>,
  ctx: { drivers: { payment(key: PaymentDriverKey): PaymentDriver }; settings: Settings; ip: string },
): Promise<CallbackResult> {
  let driver: PaymentDriver;
  try { driver = ctx.drivers.payment(driverKey); } catch { return { orderCode: "", ok: false, test: false }; }
  const { authority } = readParams(driver, params);
  const payment = authority === "" ? null : await paymentsRepo.findByAuthority(db, authority);
  if (payment === null || payment.driver !== driverKey) return processCallback(db, driverKey, params, ctx);
  if (driver.settle !== undefined && payment.status === "redirected") {
    await jobs.enqueue(db, "payment.settle", { orderId: payment.orderId, paymentId: payment.id, driver: driverKey },
      { uniqueKey: `payment.settle:${payment.id}`, runAt: new Date(Date.now() + 60_000) });
  }
  return db.transaction(async (tx) => {
    // Gateway calls have bounded timeouts, but SnappPay's documented recovery chains them (verify
    // 30 s → status → verify 30 s → status, then settle → status → settle → status, each with its
    // own token): ~200 s worst case with no statement in between. This lock is this order's only.
    await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '300s'`);
    await lockForUpdate(tx, payment.orderId);
    return processCallback(tx, driverKey, params, ctx);
  });
}

async function processCallback(
  db: Db,
  driverKey: PaymentDriverKey,
  params: Record<string, string>,
  ctx: { drivers: { payment(key: PaymentDriverKey): PaymentDriver }; settings: Settings; ip: string },
): Promise<CallbackResult> {
  const test = driverKey === "mock";

  // The driver is resolved first because parseCallback decides which field carries the authority.
  // A driver the environment refuses to build (mock in prod) must not leak that as a 500.
  let driver: PaymentDriver | null = null;
  try {
    driver = ctx.drivers.payment(driverKey);
  } catch {
    await security.event(db, "callback.forged", { driver: driverKey, note: "driver_unavailable" }, ctx.ip);
    return { orderCode: "", ok: false, test: false };
  }

  const { authority, ok: gatewaySaidOk } = readParams(driver, params);

  // Never leak whether an authority exists - an unknown/forged authority gets the generic failure.
  const payment = authority === "" ? null : await paymentsRepo.findByAuthority(db, authority);
  if (payment === null || payment.driver !== driverKey) {
    await security.event(db, "callback.forged", { driver: driverKey }, ctx.ip);
    return { orderCode: "", ok: false, test: false };
  }
  const order = await findById(db, payment.orderId);
  if (order === null) {
    await security.event(db, "callback.unknown_authority", { driver: driverKey }, ctx.ip);
    return { orderCode: "", ok: false, test: false };
  }

  // A gateway may hand us a second handle at redirect time (SnappPay's paymentToken); every later
  // call - verify, settle, revert - is keyed on it, not on the authority.
  const providerRef = payment.refId ?? undefined;
  const refArg = providerRef === undefined ? {} : { providerRef };

  // Already-paid order (replay / concurrent callback) → idempotent success, no side effects. SnappPay
  // requires exactly one verify per redirect even when the IPG calls back more than once.
  if (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered") {
    return { orderCode: order.code, ok: true, test };
  }
  // A replay after a refund/cancellation must not verify or settle the old payment again.
  if (driver.settle !== undefined && payment.status === "succeeded") return { orderCode: order.code, ok: false, test };
  // A confirmed-closed token belongs to an earlier attempt. Its late callback must not fail a
  // newly retried order or release the new attempt's inventory/loyalty reservations.
  if (driver.settle !== undefined && (payment.status === "failed" || payment.status === "expired")) return { orderCode: order.code, ok: false, test };

  if (!gatewaySaidOk && driver.settle === undefined) {
    await paymentsRepo.update(db, payment.id, { status: "failed" });
    if (order.status === "pending_payment") await orderState.transition(db, order.id, "failed", { actor: SYSTEM, settings: ctx.settings }).catch(() => undefined);
    return { orderCode: order.code, ok: false, test };
  }

  // Status OK: only the server-to-server verify (with the STORED amount) moves money state.
  const verified = await driver.verify({ amount: order.grandTotal, authority, ...refArg });
  if (!verified.ok && driver.settle !== undefined) {
    // A transport failure or duplicate verify is not proof of non-payment.
    const probe = await driver.inquiry?.({ authority, ...refArg }).catch(() => ({ ok: false }));
    const status = probe?.ok === true && "status" in probe ? probe.status : undefined;
    let closed = status === "REVERT" || status === "CANCEL";
    if (!gatewaySaidOk && status === "PENDING") {
      // The browser's FAILED flag cannot settle whether money moved. Only a confirmed unused
      // session may be reverted, and a failed/unknown revert keeps the durable recovery alive.
      closed = await releaseHold(db, driver, order.id, authority, refArg);
    }
    if (closed) {
      await paymentsRepo.update(db, payment.id, { status: "failed" });
      if (order.status === "pending_payment") await orderState.transition(db, order.id, "failed", { actor: SYSTEM, settings: ctx.settings });
    } else if (status === "VERIFY" || status === "SETTLE") {
      await paymentsRepo.update(db, payment.id, { verifiedAt: new Date().toISOString() });
    }
    // VERIFY/SETTLE (including a successful inquiry after verify timed out) is reconciled by the
    // same verify/settle path on the next run; unknown state must never become a failed payment.
    return { orderCode: order.code, ok: false, test, pending: !closed };
  }
  if (!verified.ok) {
    await paymentsRepo.update(db, payment.id, { status: "failed" });
    // Keep the gateway's own reason on the order: -50 (amount mismatch) and -54 (bad authority) are
    // the two staff actually have to chase, and without this the timeline says only "failed".
    await orderEvents
      .append(db, order.id, "payment.failed", { driver: driverKey, ...(verified.code !== undefined ? { code: verified.code } : {}), ...(verified.error !== undefined ? { reason: verified.error } : {}) }, SYSTEM)
      .catch(() => undefined);
    if (order.status === "pending_payment") await orderState.transition(db, order.id, "failed", { actor: SYSTEM, settings: ctx.settings }).catch(() => undefined);
    return { orderCode: order.code, ok: false, test };
  }

  if (verified.needsSettle === true) {
    // Expiry/failure/cancellation can win the lock before a callback or settlement retry.
    // Release the verified hold instead of capturing money for an order we cannot fulfil.
    if (order.status !== "pending_payment") {
      const reversed = await releaseHold(db, driver, order.id, authority, refArg);
      if (reversed) await paymentsRepo.update(db, payment.id, { status: "failed" });
      // The durable settlement job retries an unresolved revert; never mark it failed early.
      return { orderCode: order.code, ok: false, test, pending: !reversed };
    }
    if (driver.settle === undefined) return { orderCode: order.code, ok: false, test };
    const settled = await driver.settle({ authority, ...refArg }).catch(() => ({ ok: false }));
    if (!settled.ok) {
      await paymentsRepo.update(db, payment.id, { verifiedAt: new Date().toISOString() });
      return { orderCode: order.code, ok: false, test, pending: true };
    }
    await orderEvents.append(db, order.id, "payment.settled", { authority }, SYSTEM);
  }

  // A ZarinPal replay (code 101) can come back without ref_id; keep the stored one rather than
  // blanking the only handle a later refund has.
  const refId = refIdAfterVerify(verified.refId, payment.refId);
  await paymentsRepo.update(db, payment.id, {
    status: "succeeded",
    refId,
    cardPanMasked: maskPan(verified.cardPan),
    fee: verified.fee ?? null,
    verifiedAt: new Date().toISOString(),
  });
  if (order.status === "pending_payment") {
    await orderState.transition(db, order.id, "paid", { actor: SYSTEM, settings: ctx.settings, payload: { refId: refId ?? "" } });
  } else {
    // Late success on an expired/failed order (money already taken): the state machine forbids a
    // direct → paid, so flag it for staff (a paid payment against a non-pending order) instead.
    await security.event(db, "callback.unknown_authority", { driver: driverKey, note: "late_success", orderCode: order.code }, ctx.ip);
  }

  return { orderCode: order.code, ok: true, test };
}

/**
 * Give an unsettled hold back to the shopper; unresolved attempts retain payment recovery.
 * Only two-phase gateways get here - `settle` is what marks a driver as holding rather than
 * capturing. ZarinPal exposes `reverse` too, but there it undoes a *successful* charge (≤30 min,
 * IP-restricted), so firing it on every NOK callback would be both useless and noisy.
 */
async function releaseHold(
  db: Db,
  driver: PaymentDriver,
  orderId: string,
  authority: string,
  refArg: { providerRef?: string },
): Promise<boolean> {
  if (driver.settle === undefined || driver.reverse === undefined) return false;
  const res = await driver.reverse({ authority, ...refArg }).catch(() => ({ ok: false, error: "reverse threw" }));
  await orderEvents.append(db, orderId, "payment.reversed", { authority, ok: res.ok }, SYSTEM).catch(() => undefined);
  return res.ok;
}

export function resultRedirect(r: CallbackResult, origin: string): string {
  return `${origin}/billing/result/?o=${encodeURIComponent(r.orderCode)}&s=${r.ok ? "ok" : r.pending === true ? "pending" : "fail"}`;
}

/**
 * Close a two-phase (SnappPay) attempt nobody will finish: the shopper left SnappPay's page and the
 * order has ended or is ending. Asks SnappPay first, because only it knows whether money moved:
 * - PENDING → the session is released with Revert (their FAILED → Revert rule) and closed here;
 * - REVERT / CANCEL → nothing is held; closed here;
 * - VERIFY / SETTLE → money is held or taken: "open", the caller runs the callback path, which
 *   reverts a hold on an order that is no longer live;
 * - no answer → "unknown": leave it for the next run (never close on our own guess).
 */
export async function closeAbandonedAttempt(db: Db, driver: PaymentDriver, payment: Payment): Promise<"closed" | "open" | "unknown"> {
  if (driver.settle === undefined || driver.inquiry === undefined) return "unknown";
  const inquiry = driver.inquiry.bind(driver);
  return db.transaction(async (tx) => {
    // Use the callback's order lock for the entire probe/revert/update sequence. The argument may
    // be a stale worker snapshot: another callback can have settled it while this job was waiting.
    await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '300s'`);
    const order = await lockForUpdate(tx, payment.orderId);
    if (order === null) return "unknown";
    const current = (await paymentsRepo.listForOrder(tx, order.id)).find((p) => p.id === payment.id);
    if (current === undefined || current.driver !== driver.key) return "unknown";
    if (current.status === "succeeded") return "open";
    if (current.status === "failed" || current.status === "expired") return "closed";
    if (current.status !== "redirected" || current.authority === null) return "unknown";
    const refArg = current.refId === null ? {} : { providerRef: current.refId };
    const query = { authority: current.authority, ...refArg };
    const probe = await inquiry(query).catch(() => ({ ok: false }));
    let status = probe.ok && "status" in probe ? probe.status : undefined;
    if (status === "VERIFY" || status === "SETTLE") return "open";
    if (status === "PENDING") {
      const reversed = await driver.reverse?.(query).catch(() => ({ ok: false }));
      if (reversed?.ok !== true) {
        // The gateway can advance independently of our lock, or a successful revert can lose its
        // response. Confirm the resulting state instead of treating either outcome as expired.
        const after = await inquiry(query).catch(() => ({ ok: false }));
        status = after.ok && "status" in after ? after.status : undefined;
        if (status === "VERIFY" || status === "SETTLE") return "open";
        if (status !== "REVERT" && status !== "CANCEL") return "unknown";
      }
    } else if (status !== "REVERT" && status !== "CANCEL") return "unknown";
    await paymentsRepo.update(tx, current.id, { status: "expired" });
    return "closed";
  });
}
