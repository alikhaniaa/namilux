import { type Db, and, desc, eq, orderEvents as orderEventsTable, orders, sql } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import { jobs } from "../jobs";
import { maskPhone } from "../persian";
import type { SalesChannel } from "../channel";
import type { PaymentDriverKey } from "../constants";
import type { Settings } from "../settings/schema";
import type { Actor, Paged } from "../types";
import { orderEvents } from "./events";
import type { PaymentDriver } from "./payments";
import { refund } from "./refunds";
import { findById, payments as paymentsRepo } from "./repo";
import { orderState } from "./state";

export type ReturnRow = {
  requestId: string;
  orderId: string;
  orderCode: string;
  phoneMasked: string;
  reason: string;
  requestedAt: string;
  status: "pending" | "accepted" | "rejected";
  decidedAt: string | null;
  grandTotal: number;
  orderStatus: string;
  /** The storefront the order was placed on. */
  channel: SalesChannel;
};

export const RETURNS_PAGE_SIZE = 50;

type Payload = { kind?: unknown; reason?: unknown; requestId?: unknown; decision?: unknown };

const requestFilter = sql`${orderEventsTable.type} = 'note' and ${orderEventsTable.payloadJson}->>'kind' = 'return'`;

async function decisionsFor(db: Db, requestIds: string[]): Promise<Map<string, { decision: "accepted" | "rejected"; at: string }>> {
  const out = new Map<string, { decision: "accepted" | "rejected"; at: string }>();
  if (requestIds.length === 0) return out;
  const rows = await db
    .select({ payload: orderEventsTable.payloadJson, at: orderEventsTable.createdAt })
    .from(orderEventsTable)
    .where(sql`${orderEventsTable.type} = 'note' and ${orderEventsTable.payloadJson}->>'kind' = 'return.decision' and ${orderEventsTable.payloadJson}->>'requestId' in (${sql.join(requestIds.map((id) => sql`${id}`), sql`, `)})`);
  for (const r of rows) {
    const p = r.payload as Payload;
    if (typeof p.requestId !== "string") continue;
    out.set(p.requestId, { decision: p.decision === "accept" ? "accepted" : "rejected", at: r.at.toISOString() });
  }
  return out;
}

function toRow(
  e: { payload: unknown; at: Date; orderId: string; code: string; phone: string; grandTotal: number; status: string; channel: SalesChannel },
  decision: { decision: "accepted" | "rejected"; at: string } | undefined,
): ReturnRow {
  const p = e.payload as Payload;
  return {
    requestId: typeof p.requestId === "string" ? p.requestId : "",
    orderId: e.orderId,
    orderCode: e.code,
    phoneMasked: maskPhone(e.phone),
    reason: typeof p.reason === "string" ? p.reason : "",
    requestedAt: e.at.toISOString(),
    status: decision?.decision ?? "pending",
    decidedAt: decision?.at ?? null,
    grandTotal: e.grandTotal,
    orderStatus: e.status,
    channel: e.channel,
  };
}

export async function listReturns(db: Db, q: { status?: ReturnRow["status"]; page?: number; channel?: SalesChannel }): Promise<Paged<ReturnRow>> {
  const page = Math.max(1, q.page ?? 1);
  const rows = await db
    .select({ payload: orderEventsTable.payloadJson, at: orderEventsTable.createdAt, orderId: orders.id, code: orders.code, phone: orders.phone, grandTotal: orders.grandTotal, status: orders.status, channel: orders.channel })
    .from(orderEventsTable)
    .innerJoin(orders, eq(orders.id, orderEventsTable.orderId))
    .where(q.channel === undefined ? requestFilter : and(requestFilter, eq(orders.channel, q.channel)))
    .orderBy(desc(orderEventsTable.createdAt))
    .limit(1000);
  const decisions = await decisionsFor(
    db,
    rows.map((r) => (r.payload as Payload).requestId).filter((id): id is string => typeof id === "string"),
  );
  const all = rows.map((r) => toRow(r, decisions.get((r.payload as Payload).requestId as string)));
  const filtered = q.status === undefined ? all : all.filter((r) => r.status === q.status);
  const start = (page - 1) * RETURNS_PAGE_SIZE;
  return { items: filtered.slice(start, start + RETURNS_PAGE_SIZE), total: filtered.length, page, pageSize: RETURNS_PAGE_SIZE };
}

export async function getReturn(db: Db, requestId: string): Promise<ReturnRow | null> {
  const rows = await db
    .select({ payload: orderEventsTable.payloadJson, at: orderEventsTable.createdAt, orderId: orders.id, code: orders.code, phone: orders.phone, grandTotal: orders.grandTotal, status: orders.status, channel: orders.channel })
    .from(orderEventsTable)
    .innerJoin(orders, eq(orders.id, orderEventsTable.orderId))
    .where(and(requestFilter, sql`${orderEventsTable.payloadJson}->>'requestId' = ${requestId}`))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  const decisions = await decisionsFor(db, [requestId]);
  return toRow(row, decisions.get(requestId));
}

export async function decideReturn(
  db: Db,
  requestId: string,
  i: { decision: "accept" | "reject"; restock: boolean; refundAmount?: number; via?: "gateway" | "manual"; note?: string },
  actor: Actor,
  ctx: { settings: Settings; drivers?: { payment(key: PaymentDriverKey): PaymentDriver } },
): Promise<ReturnRow> {
  const current = await getReturn(db, requestId);
  if (current === null) throw appError("NOT_FOUND", { fa: "درخواست بازگشت پیدا نشد" });
  if (current.status !== "pending") throw appError("CONFLICT", { fa: "این درخواست قبلاً بررسی شده است" });
  const order = await findById(db, current.orderId);
  if (order === null) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });

  if (i.decision === "accept") {
    if (order.status !== "delivered") throw appError("CONFLICT", { fa: "فقط سفارش تحویل‌شده قابل مرجوع شدن است" });
    const amount = i.refundAmount ?? 0;
    // A SnappPay purchase is refunded through SnappPay (it lowers or cancels the instalments) and
    // never by hand. Decided BEFORE the order moves to «returned», so a refused refund cannot leave
    // a returned order with nothing refunded.
    const paidBy = (await paymentsRepo.listForOrder(db, order.id)).find((p) => p.status === "succeeded")?.driver;
    if (paidBy === "snapppay" && amount > 0 && i.via === "manual") {
      throw appError("VALIDATION", { fa: "بازپرداخت اسنپ‌پی باید از طریق خود درگاه انجام شود تا اقساط مشتری اصلاح شود" });
    }
    const via = i.via ?? (paidBy === "snapppay" ? "gateway" : "manual");
    if (via === "gateway" && amount > 0 && ctx.drivers === undefined) throw appError("VALIDATION", { fa: "اتصال به درگاه برای بازپرداخت در دسترس نیست" });
    await orderState.transition(db, order.id, "returned", { actor, settings: ctx.settings, restock: i.restock, payload: { requestId } });
    if (amount > 0) {
      await refund(db, order.id, amount, i.note ?? "مرجوعی", actor, via, {
        settings: ctx.settings,
        ...(ctx.drivers === undefined ? {} : { drivers: ctx.drivers }),
        restock: false,
      });
    }
    await jobs.enqueue(db, "sms.send", { template: "return.received", orderId: order.id }, { uniqueKey: `sms:return:${requestId}` });
  }

  await orderEvents.append(
    db,
    order.id,
    "note",
    { kind: "return.decision", requestId, decision: i.decision, restock: i.restock, refundAmount: i.refundAmount ?? 0, note: i.note ?? "" },
    actor,
  );
  await audit.log(db, actor, "order.return.decide", "orders", order.id, { status: "pending" }, { decision: i.decision, restock: i.restock, refundAmount: i.refundAmount ?? 0 });
  const after = await getReturn(db, requestId);
  if (after === null) throw appError("INTERNAL");
  return after;
}
