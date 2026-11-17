"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatToman } from "@namilux/core/client";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Checkbox, Field, Input, Select } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function RefundDialog({ code, maxAmount, gatewayAvailable, snapppay = false }: { code: string; maxAmount: number; gatewayAvailable: boolean; snapppay?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(maxAmount);
  const [reason, setReason] = useState("");
  const [via, setVia] = useState<"gateway" | "manual">(gatewayAvailable ? "gateway" : "manual");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy || amount === null || amount <= 0) return;
    setBusy(true);
    try {
      const result = await api<{ status: string }>(`/api/orders/${code}/refund`, { method: "POST", body: { amount, reason: reason.trim(), via, restock } });
      if (result.status === "done") toast(fa["orders.refund.done"]);
      else toast(result.status === "processing" ? "نتیجه بازپرداخت هنوز قطعی نیست. پیش از تلاش دوباره، وضعیت را با درگاه بررسی کنید." : "بازپرداخت انجام نشد؛ وضعیت درگاه را بررسی کنید.", "error");
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        {fa["orders.action.refund"]}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={fa["orders.action.refund"]}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {fa["common.cancel"]}
            </Button>
            <Button variant="danger" disabled={busy || amount === null || amount <= 0 || amount > maxAmount || reason.trim().length < 2} onClick={() => void submit()}>
              {fa["common.confirm"]}
            </Button>
          </>
        }
      >
        {snapppay ? (
          <div className="space-y-1 border border-[var(--line)] p-3 text-xs text-[var(--ink-2)]">
            <p className="font-semibold text-[var(--ink)]">بازپرداخت اسنپ‌پی</p>
            <p>بازپرداخت کامل، خرید را در اسنپ‌پی لغو می‌کند و اقساط مشتری هم لغو می‌شود. بازپرداخت جزئی، مبلغ خرید و اقساط مشتری را کم می‌کند.</p>
            <p>این کار برگشت‌ناپذیر است و فقط از راه اسنپ‌پی انجام می‌شود، نه دستی.</p>
            {amount !== null && amount > 0 && amount <= maxAmount ? (
              <p className="text-[var(--ink)]">
                {amount >= maxAmount ? "پس از تأیید: خرید اسنپ‌پی لغو می‌شود." : `پس از تأیید: مبلغ خرید اسنپ‌پی ${formatToman(maxAmount - amount)} تومان می‌شود.`}
              </p>
            ) : null}
          </div>
        ) : null}
        <MoneyInput label={fa["orders.refund.amount"]} value={amount} onChange={setAmount} hint={fa["orders.refund.max"].replace("{amount}", formatToman(maxAmount))} />
        <Field label={fa["orders.refund.reason"]}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        {snapppay ? null : (
          <Field label={fa["orders.refund.via"]}>
            <Select value={via} onChange={(e) => setVia(e.target.value as "gateway" | "manual")}>
              {gatewayAvailable ? <option value="gateway">{fa["orders.refund.gateway"]}</option> : null}
              <option value="manual">{fa["orders.refund.manual"]}</option>
            </Select>
          </Field>
        )}
        <Checkbox label={fa["orders.cancel.restock"]} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
      </Dialog>
    </>
  );
}
