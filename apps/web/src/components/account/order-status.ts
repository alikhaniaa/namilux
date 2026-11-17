import type { OrderStatus } from "@namilux/core/client";
import type { FaKey } from "@/i18n";

export const ORDER_STATUS_KEY: Record<OrderStatus, FaKey> = {
  draft: "order.status.draft",
  pending_payment: "order.status.pending_payment",
  paid: "order.status.paid",
  processing: "order.status.processing",
  shipped: "order.status.shipped",
  delivered: "order.status.delivered",
  cancelled: "order.status.cancelled",
  refunded: "order.status.refunded",
  returned: "order.status.returned",
  expired: "order.status.expired",
  failed: "order.status.failed",
};
