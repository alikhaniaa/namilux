import { z } from "zod";
import { appError, archiveCategory, categoryAdminSchema, tags, upsertCategory, getCategoryAdmin } from "@namilux/core";
import type { CategoryInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function catId(p: Record<string, string>): number {
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
  return id;
}

export const PUT = adminHandler({
  schema: categoryAdminSchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const data = { ...input, parentId: input.parentId ?? null, id: catId(params) } as CategoryInput;
    const { id, tags: t } = await upsertCategory(db, data, { type: "staff", id: staff.id, ip });
    return { id, tags: t, revalidate: t };
  },
});

export const POST = adminHandler({
  schema: z.object({ archive: z.literal(true), redirectTo: z.string().max(512).nullable().optional() }).strict(),
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const { archivedIds } = await archiveCategory(db, catId(params), input.redirectTo ?? null, { type: "staff", id: staff.id, ip });
    return { archivedIds, revalidate: [tags.nav, tags.catalog, tags.home, tags.sitemap] };
  },
});

export const GET = adminHandler({
  permission: "catalog.read",
  run: async ({ params }) => {
    const row = await getCategoryAdmin(db, catId(params));
    if (row === null) throw appError("NOT_FOUND", { details: { entity: "category" } });
    return row;
  },
});
