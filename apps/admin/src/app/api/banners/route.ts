import { bannerSchema, getBanners, upsertBanner } from "@namilux/core";
import type { BannerSlot } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "marketing.banners",
  run: ({ req }) => getBanners(db, (new URL(req.url).searchParams.get("slot") ?? "hero") as BannerSlot),
});
export const POST = adminHandler({
  schema: bannerSchema,
  permission: "marketing.banners",
  run: async ({ input, staff, ip }) => {
    const { id, tags } = await upsertBanner(db, input, { type: "staff", id: staff.id, ip });
    return { id, tags, revalidate: tags };
  },
});
