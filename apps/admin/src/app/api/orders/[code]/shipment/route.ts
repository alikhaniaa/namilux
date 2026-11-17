import { z } from "zod";
import { getSettings, recordShipment } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

const schema = z
  .object({
    carrier: z.enum(["post", "tipax", "courier", "pickup", "other"]),
    trackingCode: z.string().max(120).optional(),
    cost: z.number().int().min(0).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const POST = adminHandler({
  schema,
  permission: "orders.write",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, params.code ?? "");
    const settings = await getSettings(db);
    const s = {
      carrier: input.carrier,
      ...(input.trackingCode === undefined ? {} : { trackingCode: input.trackingCode }),
      ...(input.cost === undefined ? {} : { cost: input.cost }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    return recordShipment(db, order.id, s, { type: "staff", id: staff.id, ip }, { settings });
  },
});
