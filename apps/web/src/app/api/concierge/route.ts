import { AppError, ERROR_FA, conciergeSchema, verifyOtp } from "@namilux/core";
import { concierge } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { ensureOtpConfigured } from "@/lib/otp-config";
import { CHANNEL } from "@/lib/channel";

export const POST = handler({
  // "optional": the session PhoneOtp just created is resolved when present; a guest still passes with `code`.
  auth: "optional",
  schema: conciergeSchema,
  limit: [{ name: "contact.ip", key: ({ ip }) => ip }],
  run: async ({ input, user, ip }) => {
    const { code, ...body } = input;
    if (user !== null) return concierge.request(db, { ...body, customerId: user.customerId, ip, channel: CHANNEL });
    // A guest must prove the number: either the session PhoneOtp just created, or a code minted for
    // purpose verify_phone in this body (the spec, core concierge rule "OTP-verified in the route").
    if (code === undefined) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    ensureOtpConfigured();
    const { customerId } = await verifyOtp(db, { phone: input.phone, code, purpose: "verify_phone", ip, channel: CHANNEL });
    return concierge.request(db, { ...body, customerId, ip, channel: CHANNEL });
  },
});
