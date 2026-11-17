"use client";
import { useState } from "react";
import { STOCK_RESTORE_MAX, enDigits } from "@namilux/core/client";
import { Button, Field, Input } from "@/components/kit";
import { api, ApiError } from "@/lib/api-client";
import { fa } from "@/i18n/fa";

/**
 * The one-click stock switch above the product tabs: «ناموجود کردن» zeroes the stock, and once the
 * product is unavailable «موجود کردن» puts a quantity back, prefilled with what the last switch removed.
 */
export function UnavailableAction({ id, unavailable, restoreQty, dirty, submitting }: { id: number; unavailable: boolean; restoreQty: number; dirty: boolean; submitting: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState(String(restoreQty));
  const qty = Number(enDigits(qtyText.trim()));
  const qtyValid = qtyText.trim() !== "" && Number.isInteger(qty) && qty >= 1 && qty <= STOCK_RESTORE_MAX;
  const blocked = busy || dirty || submitting || (unavailable && !qtyValid);
  async function run(): Promise<void> {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      if (unavailable) await api(`/api/products/${id}/available`, { method: "PUT", body: { qty } });
      else await api(`/api/products/${id}/unavailable`, { method: "PUT", body: {} });
      // Reload the saved form as well as stock counters; stale untracked/backorder values must
      // never be written back by a later Save. The action is disabled while a draft is dirty.
      window.location.assign(`/products/${id}?tab=price`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fa["common.error"]);
      setBusy(false);
    }
  }
  const hint = dirty
    ? "ابتدا تغییرات محصول را ذخیره کنید."
    : unavailable
      ? "این تعداد به موجودی برمی‌گردد و کالا دوباره قابل خرید می‌شود."
      : "موجودی صفر و پیش‌سفارش خاموش می‌شود؛ قیمت و صفحهٔ کالا حفظ می‌شود.";
  return (
    <section className="flex flex-wrap items-end justify-between gap-3 border border-[var(--line)] p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{unavailable ? "این کالا ناموجود است" : "ناموجود کردن کالا"}</p>
        <p className="text-xs text-[var(--ink-2)]">{hint}</p>
        {error !== null ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {unavailable ? (
          <Field label="تعداد موجودی">
            <Input
              dir="ltr"
              inputMode="numeric"
              className="w-24"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              // The card sits inside the product form: Enter restores stock instead of saving the form.
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void run();
                }
              }}
            />
          </Field>
        ) : null}
        <Button variant={unavailable ? "default" : "outline"} disabled={blocked} onClick={() => void run()}>
          {busy ? "در حال ثبت…" : unavailable ? "موجود کردن" : "ناموجود کردن"}
        </Button>
      </div>
    </section>
  );
}
