import { AppError, ERROR_FA, cancelByCustomer, cancelOrderSchema, getSettings } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const POST = handler({
  auth: "session",
  schema: cancelOrderSchema,
  bodyCap: 2 * 1024,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    if (input.orderCode !== (params.code ?? "").toUpperCase()) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    const settings = await getSettings(db);
    const order = await cancelByCustomer(db, input.orderCode, user.customerId, input.reason ?? "", { settings });
    return { status: order.status };
  },
});
