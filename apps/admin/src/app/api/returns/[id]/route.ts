import { z } from "zod";
import { AppError, ERROR_FA, decideReturn, getReturn, getSettings } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { adminHandler } from "@/lib/http-handler";
import { inScope } from "@/lib/scope";
import { db } from "@/lib/db";
import { env } from "@/env";

const schema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    restock: z.boolean().default(true),
    refundAmount: z.number().int().min(0).optional(),
    via: z.enum(["gateway", "manual"]).optional(),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "orders.refund",
  run: async ({ input, params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    // A return of the other storefront's order answers like one that does not exist.
    const request = await getReturn(db, id);
    if (request === null || !inScope(staff, request.channel)) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    const settings = await getSettings(db);
    const drivers = paymentDrivers(env);
    return decideReturn(
      db,
      id,
      {
        decision: input.decision,
        restock: input.restock,
        ...(input.refundAmount === undefined ? {} : { refundAmount: input.refundAmount }),
        ...(input.via === undefined ? {} : { via: input.via }),
        ...(input.note === undefined ? {} : { note: input.note }),
      },
      { type: "staff", id: staff.id, ip },
      { settings, drivers: { payment: (key) => drivers.payment(key) } },
    );
  },
});
