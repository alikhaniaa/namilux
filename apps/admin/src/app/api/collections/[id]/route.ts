import { appError, collectionAdminSchema, upsertCollection } from "@namilux/core";
import type { CollectionInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const PUT = adminHandler({
  schema: collectionAdminSchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
    const { id: cid, tags } = await upsertCollection(db, { ...input, parentId: input.parentId ?? null, id } as CollectionInput, { type: "staff", id: staff.id, ip });
    return { id: cid, tags, revalidate: tags };
  },
});
