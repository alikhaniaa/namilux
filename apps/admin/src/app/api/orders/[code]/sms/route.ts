import { z } from "zod";
import { resendSms } from "@namilux/core";
import type { SmsTemplate } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

const schema = z.object({ template: z.string().min(1).max(64) }).strict();

export const POST = adminHandler({
  schema,
  permission: "orders.write",
  run: async ({ input, params, staff, ip }) => {
    const order = await scopedOrderByCode(staff, params.code ?? "");
    await resendSms(db, order.id, input.template as SmsTemplate, { type: "staff", id: staff.id, ip });
    return { ok: true };
  },
});
