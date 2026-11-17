import { inquireSnapppay } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";
import { env } from "@/env";

/**
 * «استعلام از اسنپ‌پی»: SnappPay's live status for the order's latest SnappPay attempt beside our
 * own records. Read-only on both sides, so orders.read is enough.
 */
export const GET = adminHandler({
  permission: "orders.read",
  run: async ({ params, staff }) => {
    const order = await scopedOrderByCode(staff, (params.code ?? "").toUpperCase());
    const drivers = paymentDrivers(env);
    const driver = drivers.configured("snapppay") ? drivers.payment("snapppay") : {};
    return inquireSnapppay(db, order.code, driver);
  },
});
