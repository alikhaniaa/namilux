import { attributeAdminSchema, listAttributes, upsertAttribute } from "@namilux/core";
import type { AttributeInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "catalog.read", run: () => listAttributes(db) });

export const POST = adminHandler({
  schema: attributeAdminSchema,
  permission: "catalog.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertAttribute(db, input as AttributeInput, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
