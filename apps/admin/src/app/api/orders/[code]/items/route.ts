import { z } from "zod";
import { can, editItems } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

const schema = z
  .object({
    items: z
      .array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1).max(50), unitPriceOverride: z.number().int().min(0).optional() }).strict())
      .min(1)
      .max(50),
  })
  .strict();

export const PUT = adminHandler({
  schema,
  permission: "orders.write",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, (params.code ?? "").toUpperCase());
    const items = input.items.map((i) => ({ productId: i.productId, qty: i.qty, ...(i.unitPriceOverride === undefined ? {} : { unitPriceOverride: i.unitPriceOverride }) }));
    return editItems(db, order.id, { items }, { type: "staff", id: staff.id, ip }, { allowOverride: can(staff, "catalog.price") });
  },
});
