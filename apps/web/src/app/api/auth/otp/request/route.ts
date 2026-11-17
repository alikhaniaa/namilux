import { createHash } from "node:crypto";
import { normalizePhone, otpRequestSchema, requestOtp } from "@namilux/core";
import { issueChallenge } from "@namilux/integrations";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { ensureOtpConfigured, powKey } from "@/lib/otp-config";

export const POST = handler({
  schema: otpRequestSchema,
  bodyCap: 1024,
  auth: "none",
  limit: [{ name: "otp.request.ip", key: ({ ip }) => ip }],
  run: async ({ input, ip, ua }) => {
    ensureOtpConfigured();
    const uaHash = createHash("sha256").update(ua).digest("hex");
    const result = await requestOtp(db, {
      phone: input.phone,
      purpose: input.purpose,
      ip,
      uaHash,
      ...(input.powToken !== undefined ? { powToken: input.powToken } : {}),
    });
    if (result.captchaRequired) {
      const phone = normalizePhone(input.phone) ?? input.phone;
      return { ...result, challenge: issueChallenge({ key: powKey() }, `otp:${phone}`) };
    }
    return result;
  },
});
