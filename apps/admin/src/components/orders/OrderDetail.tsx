"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderItem, OrderStatus } from "@namilux/core/client";
import { SMS_TEMPLATES, enDigits } from "@namilux/core/client";
import type { MANUAL_PAYMENT_METHODS } from "@namilux/core/client";
import { OrderItemsEditor } from "./OrderItemsEditor";
import { RefundDialog } from "./RefundDialog";
import { ShipmentForm } from "./ShipmentForm";
import { Button, Checkbox, Field, Input, Select } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa, smsTemplateLabel } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type OrderPerms = { write: boolean; refund: boolean; manualPayment: boolean; price: boolean };

export function OrderDetail({
  code,
  status,
  phone,
  grandTotal,
  refundable,
  gatewayPaid,
  snapppayPaid = false,
  items,
  perms,
}: {
  code: string;
  status: OrderStatus;
  phone: string;
  grandTotal: number;
  refundable: number;
  gatewayPaid: boolean;
  /** Paid through SnappPay: cancelling goes through the refund (it cancels the shopper's instalments). */
  snapppayPaid?: boolean;
  items: OrderItem[];
  perms: OrderPerms;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"none" | "ship" | "cancel" | "paid" | "sms">("none");
  const [cancelReason, setCancelReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]>("card_to_card");
  const [reference, setReference] = useState("");
  const [template, setTemplate] = useState<string>("order.paid");

  async function run(fn: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true);
    try {
      await fn();
      toast(done ?? fa["common.saved"]);
      setPanel("none");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  const transition = (to: "processing" | "shipped" | "delivered" | "cancelled", extra?: Record<string, unknown>) =>
    run(() => api(`/api/orders/${code}/transition`, { method: "POST", body: { to, ...extra } }));

  const editable = status === "draft" || status === "pending_payment" || status === "paid";
  const wa = `https://wa.me/98${enDigits(phone).replace(/^0/, "")}`;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        {perms.write && status === "paid" ? (
          <Button size="sm" disabled={busy} onClick={() => void transition("processing")}>
            {fa["orders.action.process"]}
          </Button>
        ) : null}
        {perms.write && (status === "paid" || status === "processing") ? (
          <Button size="sm" variant={panel === "ship" ? "default" : "outline"} onClick={() => setPanel(panel === "ship" ? "none" : "ship")}>
            {fa["orders.action.ship"]}
          </Button>
        ) : null}
        {perms.write && status === "shipped" ? (
          <Button size="sm" disabled={busy} onClick={() => void transition("delivered")}>
            {fa["orders.action.deliver"]}
          </Button>
        ) : null}
        {perms.manualPayment && (status === "pending_payment" || status === "draft") ? (
          <Button size="sm" variant={panel === "paid" ? "default" : "outline"} onClick={() => setPanel(panel === "paid" ? "none" : "paid")}>
            {fa["orders.action.markPaid"]}
          </Button>
        ) : null}
        {perms.refund && refundable > 0 ? <RefundDialog code={code} maxAmount={refundable} gatewayAvailable={gatewayPaid} snapppay={snapppayPaid} /> : null}
        {perms.write && editable ? <OrderItemsEditor code={code} items={items} canOverride={perms.price} /> : null}
        {perms.write && !snapppayPaid && (status === "pending_payment" || status === "paid" || status === "processing") ? (
          <Button size="sm" variant={panel === "cancel" ? "danger" : "ghost"} onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")}>
            {fa["orders.action.cancel"]}
          </Button>
        ) : null}
      </div>

      {snapppayPaid && (status === "paid" || status === "processing") ? (
        <p className="text-xs text-[var(--ink-2)]">
          این سفارش با اسنپ‌پی پرداخت شده است. برای لغو، از «{fa["orders.action.refund"]}» استفاده کنید: بازپرداخت کامل، اقساط مشتری را هم لغو می‌کند و سفارش «بازپرداخت‌شده» می‌شود.
        </p>
      ) : null}

      {panel === "ship" ? (
        <div className="border border-[var(--line)] p-3">
          <ShipmentForm code={code} onDone={() => setPanel("none")} />
        </div>
      ) : null}

      {panel === "cancel" ? (
        <div className="space-y-2 border border-[var(--line)] p-3">
          <Field label={fa["orders.cancel.reason"]}>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />
          </Field>
          <Checkbox label={fa["orders.cancel.restock"]} checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          <ConfirmButton
            label={fa["orders.action.cancel"]}
            confirmLabel={fa["common.confirm"]}
            disabled={busy}
            onConfirm={() => transition("cancelled", { ...(cancelReason.trim() === "" ? {} : { reason: cancelReason.trim() }), restock })}
          />
        </div>
      ) : null}

      {panel === "paid" ? (
        <div className="space-y-2 border border-[var(--line)] p-3">
          <Field label={fa["orders.paid.method"]}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as (typeof MANUAL_PAYMENT_METHODS)[number])}>
              <option value="card_to_card">{fa["orders.paid.card"]}</option>
              <option value="cash">{fa["orders.paid.cash"]}</option>
              <option value="pos">{fa["orders.paid.pos"]}</option>
            </Select>
          </Field>
          <Field label={fa["orders.paid.reference"]}>
            <Input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </Field>
          <Button size="sm" disabled={busy || reference.trim() === ""} onClick={() => void run(() => api(`/api/orders/${code}/mark-paid`, { method: "POST", body: { method, reference: reference.trim() } }))}>
            {fa["orders.action.markPaid"]}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        {perms.write ? (
          <>
            <Select className="h-8 w-48 text-xs" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {SMS_TEMPLATES.filter((t) => t !== "otp" && t !== "campaign").map((t) => (
                <option key={t} value={t}>
                  {smsTemplateLabel(t)}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/orders/${code}/sms`, { method: "POST", body: { template } }), fa["smsLog.sent"])}>
              {fa["orders.resend"]}
            </Button>
          </>
        ) : null}
        <a className="inline-flex h-8 items-center border border-[var(--line)] px-2 text-xs" href={wa} target="_blank" rel="noreferrer">
          {fa["orders.whatsapp"]}
        </a>
        {status !== "draft" && status !== "pending_payment" && status !== "cancelled" && status !== "expired" && status !== "failed" ? (
          <Link className="inline-flex h-8 items-center border border-[var(--line)] px-2 text-xs" href={`/orders/${code}/invoice`} target="_blank">
            {fa["orders.invoice"]}
          </Link>
        ) : null}
        <span className="ms-auto text-xs text-[var(--ink-2)]">{grandTotal === 0 ? "" : ""}</span>
      </div>
    </div>
  );
}
