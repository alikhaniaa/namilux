import { z } from "zod";
import { getSettings, orderState } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

const schema = z
  .object({
    to: z.enum(["processing", "shipped", "delivered", "cancelled"]),
    reason: z.string().max(500).optional(),
    restock: z.boolean().optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "orders.write",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, params.code ?? "");
    const settings = await getSettings(db);
    return orderState.transition(db, order.id, input.to, {
      actor: { type: "staff", id: staff.id, ip },
      settings,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.restock === undefined ? {} : { restock: input.restock }),
    });
  },
});
