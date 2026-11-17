import { z } from "zod";
import { getSettings, refund } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";
import { env } from "@/env";

const schema = z
  .object({
    amount: z.number().int().positive(),
    reason: z.string().trim().min(2).max(300),
    via: z.enum(["gateway", "manual"]),
    restock: z.boolean().optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "orders.refund",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, (params.code ?? "").toUpperCase());
    const settings = await getSettings(db);
    const drivers = paymentDrivers(env);
    return refund(db, order.id, input.amount, input.reason, { type: "staff", id: staff.id, ip }, input.via, {
      settings,
      ...(input.via === "gateway" ? { drivers: { payment: (key) => drivers.payment(key) } } : {}),
      ...(input.restock === undefined ? {} : { restock: input.restock }),
    });
  },
});
