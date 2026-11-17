import { z } from "zod";
import { appError, archiveBrand, brandAdminSchema, tags, upsertBrand } from "@namilux/core";
import type { BrandInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function brandId(p: Record<string, string>): number {
  const id = Number(p.id);
  if (!Number.isInteger(id) || id <= 0) throw appError("VALIDATION", { details: { field: "id" } });
  return id;
}

export const PUT = adminHandler({
  schema: brandAdminSchema,
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    const { id, tags: t } = await upsertBrand(db, { ...input, id: brandId(params) } as BrandInput, { type: "staff", id: staff.id, ip });
    return { id, tags: t, revalidate: t };
  },
});

export const POST = adminHandler({
  schema: z.object({ archive: z.literal(true), redirectTo: z.string().max(512).nullable().optional() }).strict(),
  permission: "catalog.write",
  run: async ({ input, params, staff, ip }) => {
    await archiveBrand(db, brandId(params), input.redirectTo ?? null, { type: "staff", id: staff.id, ip });
    return { ok: true, revalidate: [tags.nav, tags.catalog, tags.home, tags.sitemap] };
  },
});
