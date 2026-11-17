import type { SmsTemplate } from "@namilux/core/constants";

/**
 * `template` and `vars` travel alongside the rendered `text` because a pattern-based provider
 * (FarazSMS) does not send our text at all - it names a template registered in its own panel and
 * fills the variables. Providers that take free text simply ignore them.
 */
/** An SMS_PATTERNS key: a template, or the instalment site's own wording of it (`order.shipped@instalments`). */
export type SmsPatternKey = SmsTemplate | `${SmsTemplate}@instalments`;

/** `patternKey` picks the pattern when it is not the template itself - see `sitePatternKey` in templates.ts. */
export type SmsSendOpts = { otp?: boolean; ref?: string; template?: SmsTemplate; vars?: Record<string, string | number>; patternKey?: SmsPatternKey };

export interface SmsDriver {
  key: "mock" | "kavenegar" | "smsir" | "melipayamak" | "farazsms";
  send(to: string, text: string, opts?: SmsSendOpts): Promise<SmsSendResult>;
  status?(providerRef: string): Promise<"sent" | "delivered" | "failed" | "unknown">;
  balance?(): Promise<number | null>;
  /** Provider-side rate limit, so a campaign fan-out can pace itself instead of collecting 429s. */
  maxPerMinute?: number;
}
export type SmsSendResult = { ok: true; providerRef: string; segments: number; costToman: number | null } | { ok: false; error: string; retryable: boolean };
