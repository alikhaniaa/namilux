import { httpJson } from "../http";
import type { SmsDriver, SmsSendResult } from "./types";
import { segmentsFor } from "./segments";

type SmsirSend = { status?: number; message?: string; data?: { messageIds?: number[]; messageId?: number; cost?: number } };

const BASE = "https://api.sms.ir/v1";

function scrub(text: string, apiKey: string): string {
  return apiKey === "" ? text : text.split(apiKey).join("***");
}

export function smsirDriver(cfg: { apiKey: string; lineNumber: string; otpTemplateId?: number }): SmsDriver {
  const headers = { "content-type": "application/json", accept: "application/json", "x-api-key": cfg.apiKey };
  const rialToToman = (rial: number | undefined): number | null => (typeof rial === "number" ? Math.round(rial / 10) : null);

  return {
    key: "smsir",
    async send(to, text, opts): Promise<SmsSendResult> {
      const otp = opts?.otp === true && cfg.otpTemplateId !== undefined;
      const url = otp ? `${BASE}/send/verify` : `${BASE}/send/bulk`;
      const body = otp
        ? { mobile: to, templateId: cfg.otpTemplateId, parameters: [{ name: "CODE", value: text }] }
        : { lineNumber: cfg.lineNumber, messageText: text, mobiles: [to] };
      try {
        const res = await httpJson<SmsirSend>(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          // A send is retried only on transport/5xx failures, never on a 4xx.
          retryOn: (r, err) => (err != null ? true : r != null && r.status >= 500),
        });
        const id = res.data?.data?.messageIds?.[0] ?? res.data?.data?.messageId;
        if (res.ok && res.data?.status === 1 && id !== undefined) {
          return { ok: true, providerRef: String(id), segments: segmentsFor(text), costToman: rialToToman(res.data.data?.cost) };
        }
        return {
          ok: false,
          error: scrub(res.data?.message ?? `smsir status ${String(res.status)}`, cfg.apiKey),
          retryable: res.status >= 500,
        };
      } catch (err) {
        return { ok: false, error: scrub(err instanceof Error ? err.message : "send failed", cfg.apiKey), retryable: true };
      }
    },
    async status(providerRef) {
      try {
        const res = await httpJson<{ data?: { deliveryState?: number } }>(`${BASE}/send/${encodeURIComponent(providerRef)}`, {
          method: "GET",
          headers,
        });
        const s = res.data?.data?.deliveryState;
        if (s === 1) return "delivered";
        if (s === 2) return "failed";
        if (s === 0) return "sent";
        return "unknown";
      } catch {
        return "unknown";
      }
    },
    async balance() {
      try {
        const res = await httpJson<{ data?: number }>(`${BASE}/credit`, { method: "GET", headers });
        return rialToToman(res.data?.data);
      } catch {
        return null;
      }
    },
  };
}
