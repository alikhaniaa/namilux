import type { OrderEvent, Payment, Refund, Shipment } from "@namilux/core";
import { faInt, formatJalali } from "@namilux/core";
import { toman } from "@/lib/money";
import { NoteForm } from "./NoteForm";
import { fa, smsTemplateLabel } from "@/i18n/fa";

type Entry = { key: string; at: string; title: string; detail?: string; tone?: "ok" | "warn" | "muted" | "default"; actor?: string };

function actorLabel(a: OrderEvent["actor"]): string {
  if (a.type === "staff") return fa["security.actor"];
  if (a.type === "customer") return fa["orders.customer"];
  if (a.type === "system") return fa["actor.system"];
  return fa["actor.worker"];
}

const EVENT_LABEL: Partial<Record<OrderEvent["type"], string>> = {
  placed: fa["event.placed"],
  "payment.initiated": fa["event.payment.initiated"],
  "payment.redirected": fa["event.payment.redirected"],
  "payment.succeeded": fa["event.payment.succeeded"],
  "payment.failed": fa["event.payment.failed"],
  "payment.settled": fa["event.payment.settled"],
  "payment.reversed": fa["event.payment.reversed"],
  "status.paid": fa["event.status.paid"],
  "status.processing": fa["event.status.processing"],
  "status.shipped": fa["event.status.shipped"],
  "status.delivered": fa["event.status.delivered"],
  "status.cancelled": fa["event.status.cancelled"],
  "status.refunded": fa["event.status.refunded"],
  "status.returned": fa["event.status.returned"],
  "status.expired": fa["event.status.expired"],
  "status.failed": fa["event.status.failed"],
  note: fa["event.note"],
  "sms.sent": fa["event.sms.sent"],
  "refund.requested": fa["event.refund.requested"],
  "refund.done": fa["event.refund.done"],
  "items.edited": fa["event.items.edited"],
  "address.edited": fa["event.address.edited"],
};
const PAYMENT_LABEL: Record<string, string> = {
  initiated: fa["payment.status.initiated"], redirected: fa["payment.status.redirected"], succeeded: fa["payment.status.succeeded"], failed: fa["payment.status.failed"], expired: fa["payment.status.expired"],
};
const SMS_LABEL: Record<string, string> = { queued: fa["sms.status.queued"], sent: fa["sms.status.sent"], failed: fa["sms.status.failed"], delivered: fa["sms.status.delivered"] };
const SHIPMENT_LABEL: Record<string, string> = {
  preparing: fa["shipment.status.preparing"], shipped: fa["shipment.status.shipped"], delivered: fa["shipment.status.delivered"], returned: fa["shipment.status.returned"],
};

export function OrderTimeline({
  code,
  events,
  payments,
  refunds,
  shipments,
  smsLog,
  canWrite,
}: {
  code: string;
  events: OrderEvent[];
  payments: Payment[];
  refunds: Refund[];
  shipments: Shipment[];
  smsLog: { template: string; status: string; at: string }[];
  canWrite: boolean;
}) {
  const entries: Entry[] = [
    ...events.map((e): Entry => {
      const refundKind = e.type === "note" && e.payload !== null ? e.payload.kind : undefined;
      const refundAmount = e.payload !== null && typeof e.payload.amount === "number" ? e.payload.amount : null;
      const note =
        e.type === "note" && e.payload !== null && typeof e.payload.text === "string"
          ? e.payload.text
          : (refundKind === "refund.partial" || refundKind === "refund.full") && refundAmount !== null
            ? `${refundKind === "refund.full" ? "بازپرداخت کامل" : "بازپرداخت جزئی"} · ${toman(refundAmount)}`
            : undefined;
      const reason = e.payload !== null && typeof e.payload.reason === "string" ? e.payload.reason : undefined;
      return {
        key: `e-${String(e.id)}`,
        at: e.createdAt,
        title: EVENT_LABEL[e.type] ?? "به‌روزرسانی سفارش",
        ...(note !== undefined ? { detail: note } : reason !== undefined ? { detail: reason } : {}),
        tone: e.type.startsWith("payment.failed") || e.type.includes("cancelled") || e.type.includes("failed") ? "warn" : e.type.includes("succeeded") || e.type.includes("paid") ? "ok" : "default",
        actor: actorLabel(e.actor),
      };
    }),
    ...payments.map((p): Entry => ({ key: `p-${p.id}`, at: p.verifiedAt ?? p.createdAt, title: `${fa["orders.payment"]} · ${fa[`paymentDriver.${p.driver}`]}`, detail: `${toman(p.amount)} · ${PAYMENT_LABEL[p.status] ?? p.status}${p.refId !== null ? ` · ${p.refId}` : ""}`, tone: p.status === "succeeded" ? "ok" : p.status === "failed" ? "warn" : "muted" })),
    ...refunds.map((r): Entry => ({ key: `r-${r.id}`, at: r.doneAt ?? r.createdAt, title: fa["orders.refunds"], detail: `${toman(r.amount)} · ${fa[`refund.status.${r.status}`]} · ${r.reason}`, tone: r.status === "done" ? "ok" : "warn" })),
    ...shipments.map((s): Entry => ({ key: `s-${s.id}`, at: s.shippedAt ?? s.deliveredAt ?? "", title: `${fa["orders.shipment"]} · ${fa[`orders.carrier.${s.carrier}`]}`, detail: `${s.trackingCode ?? ""} ${SHIPMENT_LABEL[s.status] ?? s.status}`, tone: s.status === "delivered" ? "ok" : "default" })),
    ...smsLog.map((m, i): Entry => ({ key: `m-${String(i)}`, at: m.at, title: `${fa["orders.smsLog"]} · ${smsTemplateLabel(m.template)}`, detail: SMS_LABEL[m.status] ?? m.status, tone: m.status === "failed" ? "warn" : "muted" })),
  ]
    .filter((e) => e.at !== "")
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div className="space-y-4">
      {canWrite ? <NoteForm code={code} /> : null}
      <ol className="timeline">
        {entries.map((e) => (
          <li key={e.key} className="timeline__item" data-tone={e.tone ?? "default"}>
            <span className="timeline__dot" aria-hidden="true" />
            <div className="timeline__body">
              <p className="timeline__head">
                <b>{e.title}</b>
                <time dateTime={e.at}>{formatJalali(e.at, "short")}</time>
              </p>
              {e.detail !== undefined ? <p className="timeline__detail">{e.detail}</p> : null}
              {e.actor !== undefined ? <p className="timeline__actor">{e.actor}</p> : null}
            </div>
          </li>
        ))}
        {entries.length === 0 ? <li className="admin-empty">{fa["table.empty"]}</li> : null}
      </ol>
      <p className="text-xs text-ink-3">{fa["table.total"].replace("{n}", faInt(entries.length))}</p>
    </div>
  );
}
