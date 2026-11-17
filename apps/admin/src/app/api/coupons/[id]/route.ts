import { z } from "zod";
import { AppError, ERROR_FA, couponAdminSchema, couponUsage, getCoupon, setCouponActive, upsertCoupon } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

function idOf(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
  return id;
}

export const GET = adminHandler({
  permission: "marketing.coupons",
  run: async ({ params }) => {
    const id = idOf(params);
    const coupon = await getCoupon(db, id);
    if (coupon === null) throw new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND);
    return { coupon, usage: await couponUsage(db, id) };
  },
});

export const PUT = adminHandler({
  schema: couponAdminSchema,
  permission: "marketing.coupons",
  run: async ({ input, params, staff, ip }) => upsertCoupon(db, { ...input, id: idOf(params) }, { type: "staff", id: staff.id, ip }),
});

export const POST = adminHandler({
  schema: z.object({ active: z.boolean() }).strict(),
  permission: "marketing.coupons",
  run: async ({ input, params, staff, ip }) => {
    await setCouponActive(db, idOf(params), input.active, { type: "staff", id: staff.id, ip });
    return { ok: true };
  },
});
