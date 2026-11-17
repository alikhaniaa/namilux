import { AppError, ERROR_FA, effectiveFlags, getSettings, ordersRepo, retryPayment } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { db } from "@/lib/db";
import { env } from "@/env";
import { handler } from "@/lib/http-handler";

export const POST = handler({
  // "session", never "session-verified": re-opening the gateway for an order the shopper already
  // owns is the second half of a checkout that has already happened, and an unpaid order is most
  // often paid minutes or hours later - long after any OTP would be fresh. Ownership is what
  // protects it (the NOT_FOUND below), together with the session, the same-origin gate and the
  // per-customer limits. A stale session still cannot retry: resolveSession refuses it.
  auth: "session",
  bodyCap: 0,
  limit: [
    { name: "checkout.place.customer", key: ({ user, ip }) => user?.customerId ?? ip },
    { name: "checkout.place.ip", key: ({ ip }) => ip },
  ],
  run: async ({ user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const order = await ordersRepo.findByCode(db, (params.code ?? "").toUpperCase());
    // Historical channels share this storefront; ownership still guards every retry.
    if (order === null || order.customerId !== user.customerId) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    const settings = await getSettings(db);
    // Retrying re-reserves stock and opens a fresh gateway session - it IS placing the order again,
    // so it answers to the same pair placeOrder does: the stored setting and the environment
    // override. Without this a closed shop still took money for every order already pending.
    const flags = effectiveFlags(settings, env);
    if (!flags.checkoutEnabled) throw new AppError("CHECKOUT_DISABLED", 503, ERROR_FA.CHECKOUT_DISABLED);
    if (flags.maintenance) throw new AppError("MAINTENANCE", 503, ERROR_FA.MAINTENANCE);
    const drivers = paymentDrivers(env);
    // retryPayment reuses the gateway the order started on - an instalment order cannot fall back
    // to the card gateway (the shopper chose credit), and the environment's default may since have
    // changed under an old order.
    return retryPayment(db, order.id, {
      customerId: user.customerId,
      drivers: { payment: (key) => drivers.payment(key) },
      env: { SITE_ORIGIN: env.SITE_ORIGIN },
      settings,
    });
  },
});
