import type { SmsTemplate } from "@namilux/core/constants";
import { httpJson } from "../http";
import { segmentsFor } from "./segments";
import { PATTERN_VAR_LIMITS, truncateVar } from "./templates";
import type { SmsDriver, SmsSendResult } from "./types";

/**
 * FarazSMS / IranPayamak - https://docs.farazsms.com
 *
 * The one thing that decides whether this integration works:
 *
 *   pattern send  POST /ws/v1/sms/pattern   instant, never queued
 *   simple send   POST /ws/v1/sms/simple    goes to HUMAN MODERATION first
 *
 * Every non-pattern send waits for an operator to approve it, so a free-text order confirmation can
 * sit for minutes or never go out at all. Transactional messages therefore need a *pattern*
 * registered and approved in the FarazSMS panel, and its code listed in SMS_PATTERNS. The driver
 * uses a pattern whenever one is configured for the template and falls back to a simple send
 * otherwise - degrading in speed rather than failing, but the fallback is a warning sign, not a plan.
 *
 * Registering a pattern: its variable names must match our template's placeholders exactly
 * (`{code}`, `{tracking}`, …) - see REQUIRED_VARS in templates.ts for the list per template. Note
 * that a pattern send takes its WORDING from their panel, not from our `sms.templates` setting;
 * ours is then only the fallback text and the record of what should be registered there.
 *
 * Two rules learned from the 7 Sep 2026 pattern rebuild, both enforced below:
 *  - a pattern may legitimately declare NO variables (customer.welcome) - an empty attribute map is
 *    still a pattern send, and must not be demoted to the moderated free-text route;
 *  - a value longer than the length the panel declares for that variable is silently rerouted to
 *    moderation while the API still answers `success`, so every value is truncated to it first.
 */

const BASE = "https://api.iranpayamak.com";

/** Their docs: all routes are throttled at 60 requests/minute, 429 beyond that. */
export const FARAZSMS_MAX_PER_MINUTE = 60;

/** Their canonical recipient form. `+98`, spaces and dashes are all rejected. */
const RECIPIENT_RE = /^09\d{9}$/u;

/** Every response is {status, data, messages} - check `status`, not just the HTTP code. */
type Envelope<T> = { status?: string; data?: T; message?: unknown; messages?: unknown };
/** Their docs say `balanceAmount`; the live API (7 Sep 2026) answers `balance_amount`, as a string. */
type BalanceData = { balance_amount?: number | string; balanceAmount?: number | string };
/**
 * Their items endpoint is paginated and puts the rows under `data.data`, not `data.items` - 
 * measured against the live API on 7 Sep 2026 (request 13516964). The documented `items` shape
 * and a bare array are still accepted, because this is the one call that tells us a message was
 * really delivered and it must not go quiet if they change the envelope back.
 */
type ItemRow = { status?: string };
type ItemsData = { items?: ItemRow[]; data?: ItemRow[] } | ItemRow[];

export type FarazsmsConfig = {
  apiKey: string;
  /** The sender line from the panel (GET /ws/v1/lines/accessible). Their shared default is 90008361. */
  lineNumber: string;
  /** template key → pattern code (the pattern UID shown in the panel). */
  // `<template>@instalments` is the instalment site's own wording of a template (sitePatternKey)
  patterns?: Partial<Record<SmsTemplate | `${SmsTemplate}@instalments`, string>>;
  /** Per-segment price in Toman, for the daily budget ledger. */
  unitCostToman?: number;
  baseUrl?: string;
};

/** Their message text is whatever the panel holds, so a failure reason may arrive in several shapes. */
function reasonOf(body: Envelope<unknown> | null, status: number): string {
  const raw = body?.messages ?? body?.message;
  if (typeof raw === "string" && raw !== "") return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((x) => typeof x === "string");
    if (typeof first === "string") return first;
  }
  if (raw !== null && typeof raw === "object") {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v !== "") return v;
      if (Array.isArray(v)) {
        const first = v.find((x) => typeof x === "string");
        if (typeof first === "string") return first;
      }
    }
  }
  return `farazsms http ${String(status)}`;
}

/**
 * 429 and 5xx are worth another attempt; 400 (a business rule - bad pattern variable, no credit) and
 * 401 (a wrong key) will fail identically forever, and retrying them just burns the job's attempts.
 */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500 || status === 0;
}

export function normalizeRecipient(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/gu, "");
  const local = /^\+98(\d{10})$/u.exec(digits)?.[1] ?? /^0098(\d{10})$/u.exec(digits)?.[1] ?? /^98(\d{10})$/u.exec(digits)?.[1] ?? null;
  const candidate = local !== null ? `0${local}` : digits;
  return RECIPIENT_RE.test(candidate) ? candidate : null;
}

export function farazsmsDriver(cfg: FarazsmsConfig): SmsDriver {
  const base = (cfg.baseUrl ?? BASE).replace(/\/+$/u, "");
  const headers = { "Api-Key": cfg.apiKey, "content-type": "application/json", accept: "application/json" };
  const unitCost = cfg.unitCostToman;

  async function call<T>(path: string, init: { method: "GET" | "POST"; body?: Record<string, unknown> }): Promise<{ ok: boolean; body: Envelope<T> | null; status: number }> {
    const res = await httpJson<Envelope<T>>(`${base}${path}`, {
      method: init.method,
      headers,
      timeoutMs: 15_000,
      // A 400 is a verdict, not a blip - do not spend retries on it.
      retryOn: (r, err) => (err !== null && err !== undefined ? true : r !== null && retryableStatus(r.status)),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const ok = res.ok && res.data?.status === "success";
    return { ok, body: res.data, status: res.status };
  }

  return {
    key: "farazsms",
    maxPerMinute: FARAZSMS_MAX_PER_MINUTE,

    async send(to, text, opts): Promise<SmsSendResult> {
      const recipient = normalizeRecipient(to);
      if (recipient === null) return { ok: false, error: `farazsms: unusable recipient`, retryable: false };

      const template = opts?.template;
      // The instalment site's wording is a pattern of its own (opts.patternKey), never the main one:
      // with no code registered for it the message goes out as free text rather than naming namilux.ir.
      const patternCode = template === undefined ? undefined : cfg.patterns?.[opts?.patternKey ?? template];
      const vars = opts?.vars;
      const segments = segmentsFor(text);

      // A pattern needs a registered code and a variable map to fill it. `{}` is a legitimate map - 
      // customer.welcome (95DOACyydm) declares no variables at all and must still go by pattern - 
      // so only an *absent* map (a caller that resolved nothing) falls back to free text.
      const usePattern = patternCode !== undefined && patternCode !== "" && vars !== undefined;
      const limits = template === undefined ? undefined : PATTERN_VAR_LIMITS[template];

      const body: Record<string, unknown> = usePattern
        ? {
            code: patternCode,
            recipient,
            // Their attributes are a flat name→string map; a declared variable that is missing is
            // rejected outright ("فیلد X باید ارسال شود"), while an empty value is accepted. Values
            // are cut to the panel's declared length - over-length is not an error, it is a silent
            // detour into the moderation queue.
            attributes: Object.fromEntries(
              Object.entries(vars).map(([k, v]) => {
                const limit = limits?.[k];
                const s = String(v);
                return [k, limit === undefined ? s : truncateVar(s, limit)];
              }),
            ),
            line_number: cfg.lineNumber,
            number_format: "english",
          }
        : {
            text,
            recipients: [recipient],
            line_number: cfg.lineNumber,
            number_format: "english",
          };

      try {
        const res = await call<number | string>(usePattern ? "/ws/v1/sms/pattern" : "/ws/v1/sms/simple", { method: "POST", body });
        // The docs show `data: <id>`; the live API (7 Sep 2026) answers `data: { id, type, status, … }`
        // for a queued send - the first shape alone reported every real send as failed.
        const data: unknown = res.body?.data;
        const id: unknown =
          typeof data === "number" || typeof data === "string"
            ? data
            : data !== null && typeof data === "object" && "id" in data
              ? (data as { id?: unknown }).id
              : undefined;
        if (res.ok && (typeof id === "number" || typeof id === "string")) {
          return {
            ok: true,
            providerRef: String(id),
            segments,
            // They price per segment and report no cost on a send, so the ledger uses the configured
            // rate; without one the daily budget simply has nothing to count.
            costToman: unitCost === undefined ? null : segments * unitCost,
          };
        }
        return { ok: false, error: reasonOf(res.body, res.status), retryable: retryableStatus(res.status) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "farazsms send failed", retryable: true };
      }
    },

    /**
     * A 200 on a send means *accepted*, not delivered - this is the only way to learn what actually
     * happened to it. `providerRef` is the send-request id their send returned.
     */
    async status(providerRef) {
      try {
        const res = await call<ItemsData>(`/ws/v1/send_request/${encodeURIComponent(providerRef)}/items`, { method: "GET" });
        if (!res.ok) return "unknown";
        const data = res.body?.data;
        const rows: ItemRow[] = Array.isArray(data) ? data : (data?.data ?? data?.items ?? []);
        const first = rows[0]?.status;
        if (typeof first !== "string") return "unknown";
        const s = first.toLowerCase();
        // The FAILURE words are read FIRST, because "undelivered" contains "delivered": testing the
        // success word first reported every undeliverable message - a wrong number, a blacklisted
        // one, an operator reject - as delivered, and the failure branch that names "undeliver"
        // could never be reached.
        if (s.includes("undeliver") || s.includes("fail") || s.includes("reject") || s.includes("blacklist")) return "failed";
        if (s.includes("deliver")) return "delivered";
        if (s.includes("sent") || s.includes("queue") || s.includes("pending") || s.includes("approval")) return "sent";
        return "unknown";
      } catch {
        return "unknown";
      }
    },

    /** Also the cheapest way to prove the API key works - it needs no credit and sends nothing. */
    async balance() {
      try {
        const res = await call<BalanceData>("/ws/v1/account/balance", { method: "GET" });
        const raw = res.body?.data?.balance_amount ?? res.body?.data?.balanceAmount;
        if (typeof raw !== "number" && typeof raw !== "string") return null;
        const amount = Number(raw);
        return Number.isFinite(amount) ? amount : null;
      } catch {
        return null;
      }
    },
  };
}
