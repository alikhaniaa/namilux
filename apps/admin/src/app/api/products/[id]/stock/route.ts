import { adjustStock, appError, stockAdjustSchema, tags } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: stockAdjustSchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    const { stockQty } = await adjustStock(db, id, input.delta, input.reason, { type: "staff", id: staff.id, ip });
    return { stockQty, revalidate: [tags.product(id), tags.catalog] };
  },
});
