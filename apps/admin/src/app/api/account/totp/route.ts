import { cookies } from "next/headers";
import { z } from "zod";
import { signTempToken, staffTotpEnrolConfirm, staffTotpEnrolStart, totpCodeSchema } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { issueCsrf } from "@/lib/csrf";
import { db } from "@/lib/db";
import { env } from "@/env";
import { staffCookie } from "@/lib/session";

export const GET = adminHandler({
  permission: "catalog.read",
  sudo: true,
  run: async ({ staff }) => {
    // The enrolment flow is keyed by a short-lived temp token (same carrier as first-login enrolment).
    const tempToken = signTempToken(staff.id, env.SESSION_PEPPER, "totp");
    const { secretBase32, otpauth } = await staffTotpEnrolStart(db, tempToken);
    return { otpauthUri: otpauth, secret: secretBase32, tempToken };
  },
});

const confirmSchema = z.object({ tempToken: z.string().min(1).max(600), code: totpCodeSchema }).strict();

export const POST = adminHandler({
  schema: confirmSchema,
  permission: "catalog.read",
  sudo: true,
  run: async ({ input, ip, req }) => {
    const { token } = await staffTotpEnrolConfirm(db, { tempToken: input.tempToken, code: input.code, ip, ua: req.headers.get("user-agent") ?? "" });
    const jar = await cookies();
    jar.set(staffCookie(token));
    jar.set(issueCsrf());
    return { ok: true };
  },
});
