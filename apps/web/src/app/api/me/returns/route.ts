import { AppError, ERROR_FA, requestReturn, returnRequestSchema } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const POST = handler({
  auth: "session",
  schema: returnRequestSchema,
  bodyCap: 4 * 1024,
  limit: [{ name: "returns.customer", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    return requestReturn(db, input.orderCode, user.customerId, input);
  },
});
