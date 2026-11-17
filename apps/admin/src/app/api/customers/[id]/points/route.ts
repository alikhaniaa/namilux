import { AppError, ERROR_FA, loyalty, loyaltyAdjustSchema } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const POST = adminHandler({
  schema: loyaltyAdjustSchema,
  permission: "customers.points",
  run: async ({ input, params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    await loyalty.adjust(db, id, input.delta, input.note, { type: "staff", id: staff.id, ip });
    return { balance: await loyalty.balance(db, id) };
  },
});
