import { AppError, ERROR_FA } from "@namilux/core";
import { getOrderForCustomer } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const code = params.code ?? "";
    const view = await getOrderForCustomer(db, code, user.customerId);
    if (view === null) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    return view;
  },
});
