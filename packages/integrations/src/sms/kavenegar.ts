import { httpJson } from "../http";
import type { SmsDriver, SmsSendResult } from "./types";
import { segmentsFor } from "./segments";

type KavenegarEntry = { messageid?: number; cost?: number; parts?: number };
type KavenegarResponse = { return?: { status?: number; message?: string }; entries?: KavenegarEntry[] };

const BASE = "https://api.kavenegar.com/v1";

/** Never leak the API key: it lives in the URL, so scrub it from any error text. */
function scrub(text: string, apiKey: string): string {
  return apiKey === "" ? text : text.split(apiKey).join("***");
}

export function kavenegarDriver(cfg: { apiKey: string; sender: string; otpTemplate?: string }): SmsDriver {
  const rialToToman = (rial: number | undefined): number | null =>
    typeof rial === "number" ? Math.round(rial / 10) : null;

  return {
    key: "kavenegar",
    async send(to, text, opts): Promise<SmsSendResult> {
      const otpTemplate = cfg.otpTemplate;
      const url =
        opts?.otp === true && otpTemplate !== undefined
          ? `${BASE}/${cfg.apiKey}/verify/lookup.json?receptor=${encodeURIComponent(to)}&token=${encodeURIComponent(text)}&template=${encodeURIComponent(otpTemplate)}`
          : `${BASE}/${cfg.apiKey}/sms/send.json?receptor=${encodeURIComponent(to)}&sender=${encodeURIComponent(cfg.sender)}&message=${encodeURIComponent(text)}`;
      try {
        const res = await httpJson<KavenegarResponse>(url, {
          method: "GET",
          retryOn: (r, err) => (err != null ? true : r != null && r.status >= 500),
        });
        const status = res.data?.return?.status;
        const entry = res.data?.entries?.[0];
        if (res.ok && status === 200 && entry?.messageid !== undefined) {
          return {
            ok: true,
            providerRef: String(entry.messageid),
            segments: entry.parts ?? segmentsFor(text),
            costToman: rialToToman(entry.cost),
          };
        }
        return {
          ok: false,
          error: scrub(res.data?.return?.message ?? `kavenegar status ${res.status}`, cfg.apiKey),
          retryable: res.status >= 500,
        };
      } catch (err) {
        return {
          ok: false,
          error: scrub(err instanceof Error ? err.message : "send failed", cfg.apiKey),
          retryable: true,
        };
      }
    },
    async status(providerRef) {
      try {
        const res = await httpJson<{ entries?: { status?: number }[] }>(
          `${BASE}/${cfg.apiKey}/sms/status.json?messageid=${encodeURIComponent(providerRef)}`,
          { method: "GET" },
        );
        const s = res.data?.entries?.[0]?.status;
        if (s === undefined) return "unknown";
        if (s >= 10) return "delivered";
        if (s >= 4) return "sent";
        if (s === 6 || s === 11 || s === 13 || s === 14) return "failed";
        return "unknown";
      } catch {
        return "unknown";
      }
    },
    async balance() {
      try {
        const res = await httpJson<{ entries?: { remaincredit?: number } }>(
          `${BASE}/${cfg.apiKey}/account/info.json`,
          { method: "GET" },
        );
        return rialToToman(res.data?.entries?.remaincredit);
      } catch {
        return null;
      }
    },
  };
}
