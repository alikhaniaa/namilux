import type { Db } from "@namilux/db";
import { appError } from "../errors";
import { findByCode, payments as paymentsRepo, refunds as refundsRepo } from "./repo";

/** SnappPay's own transaction states (academy «self-cms» §10). */
export const SNAPPPAY_STATES = ["PENDING", "VERIFY", "SETTLE", "CANCEL", "REVERT"] as const;
export type SnapppayState = (typeof SNAPPPAY_STATES)[number];

/** What staff see after «استعلام از اسنپ‌پی». `verdict` drives the colour and the advice line. */
export type SnapppayInquiry = {
  transactionId: string;
  /** SnappPay's answer, or null when it could not be read (network, IP, credentials). */
  gateway: SnapppayState | null;
  /** What our records say the gateway should be in. */
  expected: SnapppayState[];
  verdict: "match" | "mismatch" | "unknown";
  /** One plain Persian sentence: what this means and what to do. */
  advice: string;
};

type InquiryDriver = { inquiry?: (o: { authority: string; providerRef?: string }) => Promise<{ ok: boolean; status?: string }> };

/**
 * Ask SnappPay where the order's latest SnappPay attempt stands and compare it with our records.
 * Read-only on both sides: nothing is verified, settled or cancelled from here; staff act through
 * the existing refund flow, and the settle job keeps retrying held payments by itself.
 */
export async function inquireSnapppay(db: Db, code: string, driver: InquiryDriver): Promise<SnapppayInquiry> {
  const order = await findByCode(db, code);
  if (order === null) throw appError("NOT_FOUND", { details: { entity: "order" } });
  const attempts = (await paymentsRepo.listForOrder(db, order.id)).filter((p) => p.driver === "snapppay");
  const payment = attempts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (payment === undefined || payment.authority === null) throw appError("NOT_FOUND", { fa: "این سفارش پرداختی با اسنپ‌پی ندارد." });
  if (payment.refId === null || driver.inquiry === undefined) {
    return { transactionId: payment.authority, gateway: null, expected: ["PENDING"], verdict: "unknown", advice: "مشتری هنوز وارد صفحهٔ پرداخت اسنپ‌پی نشده است؛ چیزی برای استعلام وجود ندارد." };
  }

  const refunds = await refundsRepo.listForOrder(db, order.id);
  const refundedDone = refunds.filter((r) => r.paymentId === payment.id && r.status === "done").reduce((s, r) => s + r.amount, 0);
  const openRefund = refunds.some((r) => r.paymentId === payment.id && (r.status === "requested" || r.status === "processing"));
  const expected: SnapppayState[] =
    payment.status === "succeeded"
      ? refundedDone >= payment.amount ? ["CANCEL"] : openRefund ? ["SETTLE", "CANCEL"] : ["SETTLE"]
      : payment.verifiedAt !== null ? ["VERIFY"]
      : payment.status === "failed" || payment.status === "expired" ? ["PENDING", "REVERT", "CANCEL"]
      : ["PENDING"];

  const res = await driver.inquiry({ authority: payment.authority, providerRef: payment.refId }).catch(() => ({ ok: false }));
  const raw = res.ok && "status" in res && typeof res.status === "string" ? res.status.toUpperCase() : null;
  const gateway = raw !== null && (SNAPPPAY_STATES as readonly string[]).includes(raw) ? (raw as SnapppayState) : null;
  if (gateway === null) {
    return { transactionId: payment.authority, gateway, expected, verdict: "unknown", advice: "پاسخی از اسنپ‌پی دریافت نشد. چند دقیقهٔ دیگر دوباره استعلام کنید؛ اگر ادامه داشت به پشتیبانی فنی خبر دهید." };
  }
  if (expected.includes(gateway)) {
    return { transactionId: payment.authority, gateway, expected, verdict: "match", advice: openRefund ? "بازپرداخت در حال پیگیری است؛ وضعیت اسنپ‌پی با سوابق ما سازگار است." : "وضعیت اسنپ‌پی با سوابق سایت یکی است؛ کاری لازم نیست." };
  }
  return { transactionId: payment.authority, gateway, expected, verdict: "mismatch", advice: adviceFor(gateway, payment.status === "succeeded") };
}

function adviceFor(gateway: SnapppayState, paidHere: boolean): string {
  switch (gateway) {
    case "SETTLE":
      return paidHere
        ? "اسنپ‌پی این خرید را هنوز تسویه‌شده می‌داند ولی در سایت بازپرداخت ثبت شده است. پیش از هر کاری به پشتیبانی فنی خبر دهید."
        : "اسنپ‌پی پول را از مشتری گرفته ولی سفارش در سایت پرداخت‌شده نیست. سفارش را دستی پیگیری کنید و به پشتیبانی فنی خبر دهید.";
    case "VERIFY":
      return "اعتبار مشتری نگه داشته شده ولی هنوز تسویه نشده است. سایت خودش چند بار دوباره تلاش می‌کند؛ اگر تا یک ساعت دیگر درست نشد، به پشتیبانی فنی خبر دهید.";
    case "CANCEL":
      return "اسنپ‌پی این خرید را لغوشده می‌داند ولی در سایت هنوز پرداخت‌شده است. سفارش را ارسال نکنید و به پشتیبانی فنی خبر دهید.";
    case "REVERT":
      return "اسنپ‌پی پول را به مشتری برگردانده است ولی سفارش در سایت پرداخت‌شده است. سفارش را ارسال نکنید و به پشتیبانی فنی خبر دهید.";
    case "PENDING":
      return "مشتری پرداخت را در اسنپ‌پی تمام نکرده است. اگر سفارش در سایت پرداخت‌شده است، به پشتیبانی فنی خبر دهید.";
  }
}
