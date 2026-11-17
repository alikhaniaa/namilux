import { AppError, ERROR_FA, backInStockSchema, verifyOtp } from "@namilux/core";
import { backInStock } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { ensureOtpConfigured } from "@/lib/otp-config";
import { CHANNEL } from "@/lib/channel";

export const POST = handler({
  // "optional": the session PhoneOtp just created is resolved when present; a guest still passes with `code`.
  auth: "optional",
  schema: backInStockSchema,
  limit: [{ name: "bis.ip", key: ({ ip }) => ip }],
  run: async ({ input, user, params, ip }) => {
    const productId = Number(params.id);
    if (!Number.isInteger(productId) || productId < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    if (user !== null) return backInStock.request(db, productId, input.phone, user.customerId);
    // A guest must prove the number: either the session PhoneOtp just created, or a code minted for
    // purpose back_in_stock in this body (the spec, core backInStock rule "OTP-verified in the route").
    if (input.code === undefined) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    ensureOtpConfigured();
    const { customerId } = await verifyOtp(db, { phone: input.phone, code: input.code, purpose: "back_in_stock", ip, channel: CHANNEL });
    return backInStock.request(db, productId, input.phone, customerId);
  },
});

export const DELETE = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "bis.ip", key: ({ ip }) => ip }],
  run: async ({ user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const productId = Number(params.id);
    if (!Number.isInteger(productId) || productId < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    await backInStock.cancel(db, productId, user.phone);
    return { cancelled: true };
  },
});
