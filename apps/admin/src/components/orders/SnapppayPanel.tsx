"use client";
import { useState } from "react";
import { faDigits, formatJalali, formatToman } from "@namilux/core/client";
import type { Payment, Refund } from "@namilux/core/client";
import { Button, StatusBadge } from "@/components/kit";
import { ApiError, api } from "@/lib/api-client";

type Inquiry = { transactionId: string; gateway: string | null; expected: string[]; verdict: "match" | "mismatch" | "unknown"; advice: string };

/** SnappPay's states in the words staff use (academy «self-cms» §10). */
const GATEWAY_FA: Record<string, string> = {
  PENDING: "در انتظار پرداخت مشتری",
  VERIFY: "تأییدشده، هنوز تسویه نشده",
  SETTLE: "تسویه‌شده (پول دریافت شد)",
  CANCEL: "لغوشده (اقساط مشتری لغو شد)",
  REVERT: "برگشت‌خورده به مشتری",
};

function ourState(p: Payment, refundedDone: number): { text: string; tone: "ok" | "warn" | "danger" | "muted" } {
  if (p.status === "succeeded") {
    if (refundedDone >= p.amount) return { text: "بازپرداخت کامل؛ اقساط مشتری لغو شد", tone: "muted" };
    if (refundedDone > 0) return { text: `تسویه‌شده؛ ${formatToman(refundedDone)} تومان بازپرداخت شد`, tone: "warn" };
    return { text: "تسویه‌شده (پول دریافت شد)", tone: "ok" };
  }
  if (p.verifiedAt !== null) return { text: "تأییدشده، در انتظار تسویه", tone: "warn" };
  if (p.status === "failed") return { text: "پرداخت انجام نشد", tone: "danger" };
  if (p.status === "expired") return { text: "مهلت پرداخت تمام شد", tone: "danger" };
  return { text: "مشتری پرداخت را تمام نکرده است", tone: "muted" };
}

/**
 * The order page's SnappPay card: every SnappPay attempt with its state in plain Persian, the
 * transaction number staff can quote to SnappPay support, refunds against it, and a read-only
 * «استعلام از اسنپ‌پی» that puts SnappPay's live answer beside ours.
 */
export function SnapppayPanel({ code, payments, refunds }: { code: string; payments: Payment[]; refunds: Refund[] }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Inquiry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempts = payments.filter((p) => p.driver === "snapppay").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (attempts.length === 0) return null;

  async function inquire(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Inquiry>(`/api/orders/${code}/snapppay-status`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "استعلام انجام نشد؛ دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-3">
        {attempts.map((p, i) => {
          const mine = refunds.filter((r) => r.paymentId === p.id);
          const done = mine.filter((r) => r.status === "done").reduce((s, r) => s + r.amount, 0);
          const state = ourState(p, done);
          return (
            <li key={p.id} className={i > 0 ? "border-t border-[var(--line)] pt-3 text-[var(--ink-2)]" : ""}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge tone={state.tone}>{state.text}</StatusBadge>
                <b>{formatToman(p.amount)} <small>تومان</small></b>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-[var(--ink-3)]">شمارهٔ تراکنش</dt>
                <dd className="ltr text-end font-mono">{p.authority ?? "—"}</dd>
                <dt className="text-[var(--ink-3)]">شروع پرداخت</dt>
                <dd className="text-end">{formatJalali(p.createdAt, "short")}</dd>
                {p.verifiedAt !== null ? (
                  <>
                    <dt className="text-[var(--ink-3)]">تأیید پرداخت</dt>
                    <dd className="text-end">{formatJalali(p.verifiedAt, "short")}</dd>
                  </>
                ) : null}
              </dl>
              {mine.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {mine.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span>
                        بازپرداخت {formatToman(r.amount)} تومان · {r.status === "done" ? "انجام شد" : r.status === "failed" ? "انجام نشد" : "در حال پیگیری"}
                      </span>
                      <span className="text-[var(--ink-3)]">{formatJalali(r.createdAt, "short")}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--line)] pt-3">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void inquire()}>
          {busy ? "در حال استعلام…" : "استعلام از اسنپ‌پی"}
        </Button>
        {error !== null ? <p className="mt-2 text-xs text-[var(--danger)]" role="alert">{error}</p> : null}
        {result !== null ? (
          <div className="mt-2 space-y-1" role="status">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--ink-3)]">پاسخ اسنپ‌پی:</span>
              <StatusBadge tone={result.verdict === "match" ? "ok" : result.verdict === "mismatch" ? "danger" : "muted"}>
                {result.gateway === null ? "نامشخص" : GATEWAY_FA[result.gateway] ?? result.gateway}
              </StatusBadge>
            </p>
            <p className={result.verdict === "mismatch" ? "text-[var(--danger)]" : "text-[var(--ink-2)]"}>{result.advice}</p>
            <p className="text-xs text-[var(--ink-3)]">شمارهٔ تراکنش برای پشتیبانی اسنپ‌پی: <span className="ltr font-mono">{faDigits(result.transactionId)}</span></p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
