import { closeAbandonedAttempt, handleCallback, getSettings, orderEvents, ordersRepo, orderState, refIdAfterVerify } from "@namilux/core";
import type { PaymentDriver } from "@namilux/core";
import type { Handler } from "../runtime";

const SYSTEM = { type: "system" as const, id: null };
const STALE_DRAFT_MS = 7 * 24 * 60 * 60 * 1000;

export const orderExpire: Handler = async ({ db, drivers, log, job }) => {
  void job;
  const now = new Date();
  const settings = await getSettings(db);

  const due = await ordersRepo.listDueForExpiry(db, now);
  let recovered = 0;
  let expired = 0;
  for (const order of due) {
    const payments = await ordersRepo.payments.listForOrder(db, order.id);
    const latest = payments[0] ?? null;

    if (latest !== null && latest.status === "redirected" && latest.authority !== null && latest.authority !== "") {
      // A user who paid but whose callback never arrived: reconcile with a server-to-server verify
      // against the STORED amount before giving up on the order.
      try {
        const driver = drivers.payment.payment(latest.driver);
        if (driver.settle !== undefined) {
          const result = await handleCallback(db, latest.driver, { transactionId: latest.authority, state: "OK" }, { drivers: drivers.payment, settings, ip: "127.0.0.1" });
          if (result.ok) {
            recovered += 1;
            continue;
          }
          // Not paid. An abandoned SnappPay page answers PENDING for ever: without this the order
          // never expired and its stock stayed reserved (found 5 Oct 2026). closeAbandonedAttempt
          // asks SnappPay, releases the session and closes the attempt - even when the reservation
          // job expired the order a moment earlier (the race seen live on NL-WV5BB). If SnappPay
          // cannot be asked, the order waits for the next tick: money might be held.
          const fresh = (await ordersRepo.payments.listForOrder(db, order.id)).find((p) => p.id === latest.id);
          const closed = fresh === undefined ? "unknown" : await closeAbandonedAttempt(db, driver, fresh);
          const now2 = await ordersRepo.findById(db, order.id);
          if (closed !== "closed" || now2 === null || now2.status !== "pending_payment") continue;
          // fall through to the expire transition below
        } else {
        // A two-phase gateway keys verify on the token it minted at redirect, not on the authority.
        const providerRef = latest.refId ?? undefined;
        const refArg = providerRef === undefined ? {} : { providerRef };
        const verified = await driver.verify({ amount: order.grandTotal, authority: latest.authority, ...refArg });
        if (verified.ok) {
          await ordersRepo.payments.update(db, latest.id, {
            status: "succeeded",
            // A replayed ZarinPal verify (101) can omit ref_id; keep what redirect/verify stored.
            refId: refIdAfterVerify(verified.refId, latest.refId),
            cardPanMasked: null,
            fee: verified.fee ?? null,
            verifiedAt: now.toISOString(),
          });
          await orderState.transition(db, order.id, "paid", { actor: SYSTEM, settings, payload: { refId: verified.refId } });
          recovered += 1;
          continue;
        }
        // Verify said no, so nothing was captured - but a two-phase gateway may still be sitting on
        // a hold from an abandoned redirect. Hand it back before the order expires; best effort,
        // because the order expires either way.
        await releaseHold(db, driver, order.id, latest.authority, refArg);
        }
      } catch (err) {
        // Gateway unreachable → leave pending for the next tick; do not expire on our own outage.
        log.warn({ orderId: order.id, err: err instanceof Error ? err.message : String(err) }, "verify failed; leaving pending");
        continue;
      }
    }

    try {
      const didExpire = await db.transaction(async (tx) => {
        const current = await ordersRepo.lockForUpdate(tx, order.id);
        if (current?.status !== "pending_payment" || current.expiresAt === null || new Date(current.expiresAt) > now) return false;
        const currentPayment = (await ordersRepo.payments.listForOrder(tx, order.id))[0] ?? null;
        // Cleanup and a retry each hold this same lock, but may finish between the sweep's reads.
        // A new token needs its own reconciliation; never expire it using the old token's result.
        if (currentPayment?.id !== latest?.id || currentPayment?.status === "succeeded") return false;
        await orderState.transition(tx, order.id, "expired", { actor: SYSTEM, settings });
        return true;
      });
      if (didExpire) expired += 1;
    } catch (err) {
      log.warn({ orderId: order.id, err: err instanceof Error ? err.message : String(err) }, "expire transition skipped");
    }
  }

  // Sweep: SnappPay attempts left «redirected» on orders some other path ended (the reservation
  // job, a staff cancel). Money held on such an order goes back through the callback path.
  let closedAttempts = 0;
  for (const p of await ordersRepo.payments.staleTwoPhase(db)) {
    try {
      const driver = drivers.payment.payment(p.driver);
      const r = await closeAbandonedAttempt(db, driver, p);
      if (r === "closed") closedAttempts += 1;
      else if (r === "open" && p.authority !== null) await handleCallback(db, p.driver, { transactionId: p.authority, state: "OK" }, { drivers: drivers.payment, settings, ip: "127.0.0.1" });
    } catch (err) {
      log.warn({ paymentId: p.id, err: err instanceof Error ? err.message : String(err) }, "abandoned attempt kept for the next tick");
    }
  }
  if (closedAttempts > 0) log.info({ closedAttempts }, "abandoned SnappPay attempts closed");

  const drafts = await ordersRepo.listStaleDrafts(db, new Date(now.getTime() - STALE_DRAFT_MS));
  let cancelled = 0;
  for (const draft of drafts) {
    try {
      await orderState.transition(db, draft.id, "cancelled", { actor: SYSTEM, settings, reason: "draft_stale" });
      cancelled += 1;
    } catch (err) {
      log.warn({ orderId: draft.id, err: err instanceof Error ? err.message : String(err) }, "draft cancel skipped");
    }
  }

  if (recovered + expired + cancelled > 0) log.info({ recovered, expired, cancelled }, "orders reconciled");
};

/**
 * Give an unsettled two-phase hold back to the shopper (SnappPay revert). `settle` is what marks a
 * driver as holding rather than capturing, so ZarinPal - whose `reverse` undoes a *successful*
 * charge inside 30 minutes - is never touched here.
 */
async function releaseHold(
  db: Parameters<Handler>[0]["db"],
  driver: PaymentDriver,
  orderId: string,
  authority: string,
  refArg: { providerRef?: string },
): Promise<void> {
  if (driver.settle === undefined || driver.reverse === undefined) return;
  const res = await driver.reverse({ authority, ...refArg }).catch(() => ({ ok: false }));
  await orderEvents.append(db, orderId, "payment.reversed", { authority, ok: res.ok }, SYSTEM).catch(() => undefined);
}
