import { appError, attributeAdminSchema, upsertAttribute } from "@namilux/core";
import type { AttributeInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: attributeAdminSchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    const { id: aid, tags } = await upsertAttribute(db, { ...input, id } as AttributeInput, { type: "staff", id: staff.id, ip });
    return { id: aid, tags, revalidate: tags };
  },
});
