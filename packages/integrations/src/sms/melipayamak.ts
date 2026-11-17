import { httpJson } from "../http";
import type { SmsDriver, SmsSendResult } from "./types";
import { segmentsFor } from "./segments";

type MpResult = { Value?: string | number; RetStatus?: number; StrRetStatus?: string };

const BASE = "https://rest.payamak-panel.com/api/SendSMS";

export function melipayamakDriver(cfg: { username: string; password: string; from: string; otpBodyId?: number }): SmsDriver {
  const headers = { "content-type": "application/json", accept: "application/json" };
  const scrub = (text: string): string => {
    let out = text;
    for (const secret of [cfg.password, cfg.username]) if (secret !== "") out = out.split(secret).join("***");
    return out;
  };
  const credentials = { username: cfg.username, password: cfg.password };

  return {
    key: "melipayamak",
    async send(to, text, opts): Promise<SmsSendResult> {
      const otp = opts?.otp === true && cfg.otpBodyId !== undefined;
      const url = otp ? `${BASE}/BaseServiceNumber` : `${BASE}/SendSMS`;
      const body = otp ? { ...credentials, text, to, bodyId: cfg.otpBodyId } : { ...credentials, to, from: cfg.from, text };
      try {
        const res = await httpJson<MpResult>(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          retryOn: (r, err) => (err != null ? true : r != null && r.status >= 500),
        });
        const value = Number(res.data?.Value ?? 0);
        if (res.ok && res.data?.RetStatus === 1 && Number.isFinite(value) && value > 0) {
          return { ok: true, providerRef: String(value), segments: segmentsFor(text), costToman: null };
        }
        return {
          ok: false,
          error: scrub(res.data?.StrRetStatus ?? `melipayamak status ${String(res.status)}`),
          retryable: res.status >= 500,
        };
      } catch (err) {
        return { ok: false, error: scrub(err instanceof Error ? err.message : "send failed"), retryable: true };
      }
    },
    async balance() {
      try {
        const res = await httpJson<MpResult>(`${BASE}/GetCredit`, { method: "POST", headers, body: JSON.stringify(credentials) });
        const value = Number(res.data?.Value);
        return Number.isFinite(value) ? Math.round(value / 10) : null;
      } catch {
        return null;
      }
    },
  };
}
