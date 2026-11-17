import { appError, pageSchema, upsertPage } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: pageSchema,
  permission: "content.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    const { id: pid, tags } = await upsertPage(db, { ...input, id }, { type: "staff", id: staff.id, ip });
    return { id: pid, tags, revalidate: tags };
  },
});
