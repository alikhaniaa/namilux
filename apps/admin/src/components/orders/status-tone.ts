import type { OrderStatus } from "@namilux/core/client";

export function statusTone(s: OrderStatus): "ok" | "warn" | "muted" | "default" {
  if (s === "paid" || s === "delivered" || s === "shipped") return "ok";
  if (s === "cancelled" || s === "failed" || s === "expired" || s === "refunded" || s === "returned") return "muted";
  if (s === "pending_payment" || s === "processing") return "warn";
  return "default";
}
