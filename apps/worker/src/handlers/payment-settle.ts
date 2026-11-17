import { closeAbandonedAttempt, getSettings, handleCallback, ordersRepo } from "@namilux/core";
import type { Handler } from "../runtime";

/** Reuses the locked callback path; stock and notifications only follow confirmed settlement. */
export const paymentSettle: Handler = async ({ db, drivers, job }) => {
  const orderId = typeof job.payload["orderId"] === "string" ? job.payload["orderId"] : "";
  const paymentId = job.payload["paymentId"];
  const payment = (await ordersRepo.payments.listForOrder(db, orderId)).find((p) => p.id === paymentId);
  if (!payment || !payment.authority) throw new Error("payment.settle: missing payment");
  if (payment.status === "succeeded" || payment.status === "failed" || payment.status === "expired") return;
  const driver = drivers.payment.payment(payment.driver);
  if (!driver.settle) return;
  const params = payment.driver === "snapppay" ? { transactionId: payment.authority, state: "OK" } : { Authority: payment.authority, Status: "OK" };
  const result = await handleCallback(db, payment.driver, params, { drivers: drivers.payment, settings: await getSettings(db), ip: "127.0.0.1" });
  const updated = (await ordersRepo.payments.listForOrder(db, orderId)).find((p) => p.id === payment.id);
  if (result.ok || updated === undefined || updated.status === "failed" || updated.status === "expired") return;
  // Every SnappPay callback schedules this job, including the expiry job's own check of an
  // abandoned page. If the order has ended and SnappPay says nothing is held, close the attempt
  // instead of retrying until the job dies (seen live on NL-WV5BB, 5 Oct 2026).
  const order = await ordersRepo.findById(db, orderId);
  if (order !== null && order.status !== "pending_payment" && (await closeAbandonedAttempt(db, driver, updated)) === "closed") return;
  throw new Error("payment.settle: gateway state remains unresolved");
};
