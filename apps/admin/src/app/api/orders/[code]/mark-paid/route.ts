import { z } from "zod";
import { getSettings, markPaidManually } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

const schema = z.object({ method: z.enum(["card_to_card", "cash", "pos"]), reference: z.string().min(1).max(120) }).strict();

export const POST = adminHandler({
  schema,
  permission: "orders.manual_payment",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, params.code ?? "");
    const settings = await getSettings(db);
    return markPaidManually(db, order.id, input, { type: "staff", id: staff.id, ip }, { settings });
  },
});
