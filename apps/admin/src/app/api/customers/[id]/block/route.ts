import { z } from "zod";
import { appError, blockCustomer, unblockCustomer } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

const schema = z.object({ blocked: z.boolean(), reason: z.string().max(500).optional() }).strict();

export const POST = adminHandler({
  schema,
  permission: "customers.write",
  run: async ({ input, params, staff, ip }) => {
    const id = params.id ?? "";
    if (id === "") throw appError("VALIDATION", { details: { field: "id" } });
    const actor = { type: "staff" as const, id: staff.id, ip };
    if (input.blocked) await blockCustomer(db, id, input.reason ?? "", actor);
    else await unblockCustomer(db, id, actor);
    return { ok: true };
  },
});
