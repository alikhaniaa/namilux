import { collectionAdminSchema, listCollections, upsertCollection } from "@namilux/core";
import type { CollectionInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "catalog.read", run: () => listCollections(db) });

export const POST = adminHandler({
  schema: collectionAdminSchema,
  permission: "catalog.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertCollection(db, { ...input, parentId: input.parentId ?? null } as CollectionInput, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
