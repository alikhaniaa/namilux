import { AppError, ERROR_FA } from "@namilux/core";
import { listOrdersForCustomer } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user, req }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const page = Number(new URL(req.url).searchParams.get("page") ?? "1");
    return listOrdersForCustomer(db, user.customerId, Number.isInteger(page) && page > 0 ? page : 1);
  },
});
