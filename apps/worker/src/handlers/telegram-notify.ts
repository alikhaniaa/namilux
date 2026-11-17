import { TELEGRAM_EVENTS, ordersRepo } from "@namilux/core";
import type { TelegramEvent } from "@namilux/core/constants";
import { formatEvent } from "@namilux/integrations";
import type { Handler } from "../runtime";

const isTelegramEvent = (v: unknown): v is TelegramEvent =>
  typeof v === "string" && (TELEGRAM_EVENTS as readonly string[]).includes(v);

export const telegramNotify: Handler = async ({ db, drivers, log, job }) => {
  // Not configured (no bot token/chat) → nothing to do; the event was still recorded upstream.
  if (!drivers.telegram.enabled) return;

  const p = job.payload;
  const data: Record<string, unknown> = { ...p };
  let kind: TelegramEvent | null = null;

  if (isTelegramEvent(p.kind)) {
    // security.alert / otp.breaker / admin.login are enqueued already keyed by `kind`.
    kind = p.kind;
  } else if (p.event === "order.paid" && typeof p.orderId === "string") {
    // orders/state enqueues { event, orderId } - enrich with the coarse facts the owner sees.
    const order = await ordersRepo.findById(db, p.orderId);
    if (order === null) return;
    kind = "order.paid";
    data.code = order.code;
    data.total = order.grandTotal;
    data.city = order.address.city;
  } else if (p.event === "concierge.request") {
    kind = "concierge.request";
  } else if (isTelegramEvent(p.event)) {
    kind = p.event;
  }

  if (kind === null) {
    log.warn({ payloadKeys: Object.keys(p) }, "telegram-notify: unrecognised payload; skipping");
    return;
  }

  const text = formatEvent(kind, data);
  const ok = await drivers.telegram.send(text);
  if (!ok) throw new Error("telegram send failed"); // retryable
  log.info({ kind, outcome: "sent" }, "telegram sent");
};
