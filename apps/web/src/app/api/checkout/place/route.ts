import { AppError, ERROR_FA, getSettings, placeOrder, placeRequestSchema } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { CHANNEL } from "@/lib/channel";
import { db } from "@/lib/db";
import { env } from "@/env";
import { handler } from "@/lib/http-handler";
export const POST = handler({
    auth: "session",
    schema: placeRequestSchema,
    bodyCap: 8 * 1024,
    limit: [
        { name: "checkout.place.customer", key: ({ user, ip }) => user?.customerId ?? ip },
        { name: "checkout.place.ip", key: ({ ip }) => ip },
    ],
    run: async ({ input, user, ip, ua }) => {
        if (user === null)
            throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
        const settings = await getSettings(db);
        const drivers = paymentDrivers(env);
        const result = await placeOrder(db, input, {
            customerId: user.customerId,
            phone: user.phone,
            ip,
            ua,
            settings,
            // CHECKOUT_ENABLED / MAINTENANCE are the emergency overrides: placeOrder hands them to
            // effectiveFlags beside the stored settings, so `release.sh set-env CHECKOUT_ENABLED=0` +
            // restart closes online checkout without an admin login. Unset → the setting decides.
            env: {
                SITE_ORIGIN: env.SITE_ORIGIN,
                QUOTE_SIGNING_KEY: env.QUOTE_SIGNING_KEY,
                PAYMENT_DRIVER: env.PAYMENT_DRIVER,
                SNAPPPAY_ENABLED: env.SNAPPPAY_ENABLED,
                CHECKOUT_ENABLED: env.CHECKOUT_ENABLED,
                MAINTENANCE: env.MAINTENANCE,
            },
            channel: CHANNEL,
            drivers: { payment: (key) => drivers.payment(key) },
        });
        return { orderCode: result.order.code, payment: result.payment };
    },
});
