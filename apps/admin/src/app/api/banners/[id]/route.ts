import { AppError, ERROR_FA, bannerSchema, deleteBanner, upsertBanner } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function idOf(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
  return id;
}

export const PUT = adminHandler({
  schema: bannerSchema,
  permission: "marketing.banners",
  run: async ({ input, params, staff, ip }) => {
    const id = idOf(params);
    const result = await upsertBanner(db, { ...input, id }, { type: "staff", id: staff.id, ip });
    return { id: result.id, revalidate: result.tags };
  },
});

export const DELETE = adminHandler({
  permission: "marketing.banners",
  run: async ({ params, staff, ip }) => {
    const id = idOf(params);
    const { tags } = await deleteBanner(db, id, { type: "staff", id: staff.id, ip });
    return { deleted: id, revalidate: tags };
  },
});
