import "server-only";
import { configureOtp } from "@namilux/core";
import { type PowSolution, renderTemplate, smsDriver, verifySolution } from "@namilux/integrations";
import { env } from "@/env";

let configured = false;

export function powKey(): string {
  return env.OTP_PEPPER;
}

export function parsePowToken(token: string): PowSolution | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const sol = JSON.parse(json) as PowSolution;
    if (typeof sol.salt !== "string" || typeof sol.nonce !== "number") return null;
    return sol;
  } catch {
    return null;
  }
}

export function ensureOtpConfigured(): void {
  if (configured) return;
  const driver = smsDriver({
    SMS_DRIVER: env.SMS_DRIVER,
    ...(env.SMS_API_KEY !== undefined ? { SMS_API_KEY: env.SMS_API_KEY } : {}),
    ...(env.SMS_SENDER !== undefined ? { SMS_SENDER: env.SMS_SENDER } : {}),
    // Without SMS_PATTERNS the driver has no pattern for `otp` and every login code goes out as
    // free text - which FarazSMS holds for a human moderator and, on the shared service line,
    // rejects outright. It was missing here until 7 Sep 2026, so no login code was arriving.
    ...(env.SMS_PATTERNS !== undefined ? { SMS_PATTERNS: env.SMS_PATTERNS } : {}),
    ...(env.SMS_UNIT_COST_TOMAN !== undefined ? { SMS_UNIT_COST_TOMAN: env.SMS_UNIT_COST_TOMAN } : {}),
    MEDIA_DIR: process.env.MEDIA_DIR ?? "./.media",
    APP_ENV: env.APP_ENV,
  });

  configureOtp({
    async send({ phone, code }) {
      const { text } = renderTemplate("otp", { code });
      // `template`/`vars` matter for a pattern-based provider: FarazSMS sends its own registered
      // OTP pattern (instant) instead of our free text (held for moderation).
      const result = await driver.send(phone, text, { otp: true, template: "otp", vars: { code } });
      if (result.ok) {
        return {
          ok: true,
          providerRef: result.providerRef,
          ...(result.costToman !== null ? { cost: result.costToman } : {}),
        };
      }
      return { ok: false, error: result.error };
    },
    async verifyPow(token, scope) {
      const sol = parsePowToken(token);
      if (sol === null) return false;
      return verifySolution({ key: powKey() }, scope, sol).ok;
    },
  });

  configured = true;
}
