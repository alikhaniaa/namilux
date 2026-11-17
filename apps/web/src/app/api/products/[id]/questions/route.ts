import { AppError, ERROR_FA, questionSchema, questions } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { CHANNEL } from "@/lib/channel";

export const POST = handler({
  auth: "session",
  schema: questionSchema,
  bodyCap: 4 * 1024,
  limit: [{ name: "questions.customer", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, ip, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const productId = Number(params.id);
    if (!Number.isInteger(productId) || productId < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return questions.ask(db, { ...input, productId, customerId: user.customerId, phone: user.phone, ip, channel: CHANNEL });
  },
});
