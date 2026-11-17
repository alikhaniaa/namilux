import { z } from "zod";
import { addNote, adminDetail, appError, ordersRepo } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { inScope, scopedOrderByCode } from "@/lib/scope";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "orders.read",
  run: async ({ params, staff }) => {
    const view = await adminDetail(db, params.code ?? "");
    if (!inScope(staff, view.channel)) throw appError("NOT_FOUND", { details: { entity: "order" } });
    return view;
  },
});

const putSchema = z
  .object({ adminNote: z.string().max(2000).optional(), customerNote: z.string().max(2000).nullable().optional() })
  .strict();

export const PUT = adminHandler({
  schema: putSchema,
  permission: "orders.write",
  run: async ({ input, params, staff, ip }) => {
    // Address edits go through a dedicated flow (editAddress); this PUT covers notes only.
    const order = await scopedOrderByCode(staff, params.code ?? "");
    const actor = { type: "staff" as const, id: staff.id, ip };
    if (input.adminNote !== undefined && input.adminNote.trim() !== "") await addNote(db, order.id, input.adminNote, actor);
    if (input.customerNote !== undefined) await ordersRepo.updateOrder(db, order.id, { customerNote: input.customerNote });
    return { ok: true };
  },
});
