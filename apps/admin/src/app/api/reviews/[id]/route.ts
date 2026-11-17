import { AppError, ERROR_FA, reviewModerateSchema, reviews, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: reviewModerateSchema,
  permission: "inbox.reply",
  run: async ({ input, params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    const { productId } = await reviews.moderate(db, id, input.status, input.reply ?? null, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.product(productId)] };
  },
});
