import { brandAdminSchema, listBrands, upsertBrand } from "@namilux/core";
import type { BrandInput } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({ permission: "catalog.read", run: () => listBrands(db) });

export const POST = adminHandler({
  schema: brandAdminSchema,
  permission: "catalog.write",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertBrand(db, input as BrandInput, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
