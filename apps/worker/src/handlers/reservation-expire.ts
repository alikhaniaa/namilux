import { expireReservations, getSettings, orderState } from "@namilux/core";
import type { Handler } from "../runtime";

const SYSTEM = { type: "system" as const, id: null };

export const reservationExpire: Handler = async ({ db, log }) => {
  const settings = await getSettings(db);
  let expired = 0;
  // The core holds this order's callback lock through BOTH release and lifecycle effects.
  const { orders } = await expireReservations(db, new Date(), async (tx, orderId) => {
    await orderState.transition(tx, orderId, "expired", { actor: SYSTEM, settings });
    expired += 1;
  });
  if (orders.length === 0) return;
  log.info({ released: orders.length, expired }, "reservations expired");
};
