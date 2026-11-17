import { cookies } from "next/headers";
import { createSession, getCustomer, otpVerifySchema, verifyOtp } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { ensureOtpConfigured } from "@/lib/otp-config";
import { sessionCookie } from "@/lib/session";
import { CHANNEL } from "@/lib/channel";

export const POST = handler({
  schema: otpVerifySchema,
  bodyCap: 1024,
  auth: "none",
  limit: [{ name: "otp.verify.ip", key: ({ ip }) => ip }],
  run: async ({ input, ip, ua }) => {
    ensureOtpConfigured();
    const { customerId } = await verifyOtp(db, { phone: input.phone, code: input.code, purpose: input.purpose, ip, channel: CHANNEL });
    const { token, expiresAt } = await createSession(db, customerId, { ip, ua });
    (await cookies()).set(sessionCookie(token, expiresAt));
    const customer = await getCustomer(db, customerId);
    return { customerId, firstName: customer?.firstName ?? null };
  },
});
