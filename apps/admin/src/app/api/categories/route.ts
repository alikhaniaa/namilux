import { categoryAdminSchema, listCategoryTree, upsertCategory } from "@namilux/core";
import type { CategoryInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "catalog.read", run: () => listCategoryTree(db) });

export const POST = adminHandler({
  schema: categoryAdminSchema,
  permission: "catalog.write",
  run: async ({ input, staff, ip }) => {
    const data = { ...input, parentId: input.parentId ?? null } as CategoryInput;
    const { id, tags } = await upsertCategory(db, data, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
