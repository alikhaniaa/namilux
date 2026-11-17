import { join } from "node:path";
import type { SmsDriver } from "./types";
import { mockSmsDriver } from "./mock";
import { kavenegarDriver } from "./kavenegar";
import { smsirDriver } from "./smsir";
import { melipayamakDriver } from "./melipayamak";
import { farazsmsDriver } from "./farazsms";
import type { SmsTemplate } from "@namilux/core/constants";

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(`SMS driver misconfigured: ${name} is required`);
  }
  return value;
}

/**
 * FarazSMS names its templates by a per-account pattern code, so the map lives in the environment
 * next to the key. Anything unparseable is treated as "no patterns configured": the driver then
 * falls back to free-text sends, which is slow but visible, rather than refusing to start.
 */
export function parsePatterns(raw: string | undefined): Partial<Record<SmsTemplate | `${SmsTemplate}@instalments`, string>> {
  if (raw === undefined || raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Partial<Record<SmsTemplate | `${SmsTemplate}@instalments`, string>> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string" && v !== "") out[k as SmsTemplate] = v;
  }
  return out;
}

export function smsDriver(env: {
  SMS_DRIVER: "mock" | "kavenegar" | "smsir" | "melipayamak" | "farazsms";
  SMS_API_KEY?: string;
  SMS_SENDER?: string;
  SMS_USERNAME?: string;
  SMS_PASSWORD?: string;
  SMS_OTP_TEMPLATE?: string;
  SMS_PATTERNS?: string;
  SMS_UNIT_COST_TOMAN?: number;
  MEDIA_DIR: string;
  APP_ENV: string;
}): SmsDriver {
  switch (env.SMS_DRIVER) {
    case "mock": {
      if (env.APP_ENV === "prod") throw new Error("mock SMS driver is refused in production");
      return mockSmsDriver({ outboxPath: join(env.MEDIA_DIR, "..", ".sms-outbox.jsonl") });
    }
    case "kavenegar":
      return kavenegarDriver({
        apiKey: required(env.SMS_API_KEY, "SMS_API_KEY"),
        sender: required(env.SMS_SENDER, "SMS_SENDER"),
        ...(env.SMS_OTP_TEMPLATE !== undefined ? { otpTemplate: env.SMS_OTP_TEMPLATE } : {}),
      });
    case "smsir":
      return smsirDriver({
        apiKey: required(env.SMS_API_KEY, "SMS_API_KEY"),
        lineNumber: required(env.SMS_SENDER, "SMS_SENDER"),
        ...(env.SMS_OTP_TEMPLATE ? { otpTemplateId: Number(env.SMS_OTP_TEMPLATE) } : {}),
      });
    case "farazsms":
      return farazsmsDriver({
        apiKey: required(env.SMS_API_KEY, "SMS_API_KEY"),
        lineNumber: required(env.SMS_SENDER, "SMS_SENDER"),
        patterns: parsePatterns(env.SMS_PATTERNS),
        ...(env.SMS_UNIT_COST_TOMAN !== undefined ? { unitCostToman: env.SMS_UNIT_COST_TOMAN } : {}),
      });
    case "melipayamak":
      return melipayamakDriver({
        username: required(env.SMS_USERNAME, "SMS_USERNAME"),
        password: required(env.SMS_PASSWORD, "SMS_PASSWORD"),
        from: required(env.SMS_SENDER, "SMS_SENDER"),
        ...(env.SMS_OTP_TEMPLATE ? { otpBodyId: Number(env.SMS_OTP_TEMPLATE) } : {}),
      });
    default: {
      const exhaustive: never = env.SMS_DRIVER;
      throw new Error(`unknown SMS driver: ${String(exhaustive)}`);
    }
  }
}
