import { type Db, asc, eq, orderEvents as orderEventsTbl } from "@namilux/db";
import { ORDER_EVENT_TYPES } from "../constants";
import type { OrderEventType, ShipmentCarrier } from "../constants";
import type { Actor, CustomerTimelineStep, JsonObject, OrderEvent } from "../types";

export type { CustomerTimelineStep } from "../types";

const LABELS: Record<CustomerTimelineStep["key"], string> = {
  placed: "ثبت سفارش",
  paid: "پرداخت شد",
  processing: "در حال آماده‌سازی",
  shipped: "ارسال شد",
  delivered: "تحویل داده شد",
  cancelled: "لغو شد",
  refunded: "بازپرداخت شد",
  returned: "مرجوع شد",
};

function mapEvent(r: typeof orderEventsTbl.$inferSelect): OrderEvent {
  const type: OrderEventType = ORDER_EVENT_TYPES.some((x) => x === r.type) ? (r.type as OrderEventType) : "note";
  return {
    id: r.id,
    type,
    payload: r.payloadJson,
    actor: { type: r.actorType, id: r.actorId },
    createdAt: r.createdAt.toISOString(),
  };
}

export const orderEvents = {
  async append(db: Db, orderId: string, type: OrderEventType, payload: JsonObject, actor: Actor): Promise<OrderEvent> {
    const rows = await db
      .insert(orderEventsTbl)
      .values({ orderId, type, payloadJson: payload, actorType: actor.type, actorId: actor.id })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error("insert returned no row");
    return mapEvent(row);
  },
  async list(db: Db, orderId: string): Promise<OrderEvent[]> {
    const rows = await db.select().from(orderEventsTbl).where(eq(orderEventsTbl.orderId, orderId)).orderBy(asc(orderEventsTbl.createdAt), asc(orderEventsTbl.id));
    return rows.map(mapEvent);
  },
  // Pure projection: the linear happy-path steps, each marked done when its status event exists; the
  // latest payment attempt only. Admin notes and internal events (sms/items/refund) are hidden.
  customerTimeline(events: OrderEvent[]): CustomerTimelineStep[] {
    const at = (type: OrderEventType): string | null => {
      const last = events.filter((e) => e.type === type).at(-1);
      return last?.createdAt ?? null;
    };
    const step = (key: CustomerTimelineStep["key"], when: string | null, extra?: Partial<CustomerTimelineStep>): CustomerTimelineStep => ({
      key,
      at: when,
      label: LABELS[key],
      done: when !== null,
      ...extra,
    });

    const placedAt = at("placed") ?? events.at(0)?.createdAt ?? null;
    const shippedEvent = events.filter((e) => e.type === "status.shipped").at(-1);
    const payload = shippedEvent?.payload ?? null;
    const tracking =
      shippedEvent !== undefined
        ? {
            carrier: (payload?.["carrier"] as ShipmentCarrier | undefined) ?? "post",
            code: (payload?.["trackingCode"] as string | null | undefined) ?? null,
            url: (payload?.["trackingUrl"] as string | null | undefined) ?? null,
          }
        : undefined;

    const steps: CustomerTimelineStep[] = [
      step("placed", placedAt),
      step("paid", at("status.paid")),
      step("processing", at("status.processing")),
      step("shipped", at("status.shipped"), tracking !== undefined ? { tracking } : {}),
      step("delivered", at("status.delivered")),
    ];
    // Terminal off-path states replace the tail when they occurred.
    for (const [type, key] of [
      ["status.cancelled", "cancelled"],
      ["status.refunded", "refunded"],
      ["status.returned", "returned"],
    ] as const) {
      const when = at(type);
      if (when !== null) steps.push(step(key, when));
    }
    return steps;
  },
};
