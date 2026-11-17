import { couponAdminSchema, listCoupons, upsertCoupon } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "marketing.coupons",
  run: ({ req }) => {
    const sp = new URL(req.url).searchParams;
    const active = sp.get("active");
    const page = Number(sp.get("page") ?? "1");
    return listCoupons(db, {
      ...(sp.get("q") === null ? {} : { q: sp.get("q") ?? "" }),
      ...(active === "1" ? { active: true } : active === "0" ? { active: false } : {}),
      page: Number.isInteger(page) && page > 0 ? page : 1,
    });
  },
});

export const POST = adminHandler({
  schema: couponAdminSchema,
  permission: "marketing.coupons",
  run: async ({ input, staff, ip }) => upsertCoupon(db, input, { type: "staff", id: staff.id, ip }),
});
