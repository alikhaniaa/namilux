import { faInt, maskPhone } from "@namilux/core";
import type { TelegramEvent } from "@namilux/core/constants";
import { httpJson } from "../http";

const TIMEOUT_MS = 5_000;
const API = "https://api.telegram.org";

/** Only the three characters HTML parse mode treats specially (Telegram docs). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function telegramClient(
  cfg: { botToken: string; chatId: string } | null,
): { send(text: string, opts?: { silent?: boolean }): Promise<boolean>; enabled: boolean } {
  const enabled = cfg !== null;
  return {
    enabled,
    async send(text: string, opts?: { silent?: boolean }): Promise<boolean> {
      if (cfg === null) return false;
      const url = `${API}/bot${cfg.botToken}/sendMessage`;
      const body = JSON.stringify({
        chat_id: cfg.chatId,
        text,
        parse_mode: "HTML",
        disable_notification: opts?.silent ?? false,
      });
      // One retry on transient failure; the send is fire-and-forget so a hard failure returns false
      // rather than throwing into a request/worker path.
      try {
        const res = await httpJson<{ ok: boolean }>(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          timeoutMs: TIMEOUT_MS,
          retries: 1,
          // POST is idempotent enough for a notification; retry only on network/5xx, never on 4xx.
          retryOn: (r, e) => (e !== null && e !== undefined) || (r !== null && r.status >= 500),
        });
        return res.ok && res.data?.ok === true;
      } catch {
        return false;
      }
    },
  };
}

function str(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function toman(payload: Record<string, unknown>, key: string): string {
  const v = Number(payload[key]);
  return Number.isFinite(v) ? `${faInt(v)} تومان` : "";
}

/**
 * Per-kind Persian message. Payloads carry ids and coarse facts only - never a full phone (masked),
 * an address, or a token. Keys match what the core enqueuers (orders/state, security, breaker,
 * staff, concierge) actually send, plus the fields the worker handlers enrich before formatting.
 */
export function formatEvent(kind: TelegramEvent, payload: Record<string, unknown>): string {
  const code = escapeHtml(str(payload, "code"));
  const city = escapeHtml(str(payload, "city") || str(payload, "province"));
  switch (kind) {
    case "order.paid":
      return `🛍 سفارش پرداخت‌شده <b>${code}</b> — ${toman(payload, "total")}${city ? ` — ${city}` : ""}`;
    case "concierge.request":
      return `💬 درخواست مشاورهٔ تازه ثبت شد`;
    case "contact.message":
      return `✉️ پیام تماس تازه — ${escapeHtml(str(payload, "subject") || "بدون موضوع")}`;
    case "stock.low":
      return `📉 موجودی کم: «${escapeHtml(str(payload, "name"))}» — ${faInt(Number(payload.stock) || 0)} عدد`;
    case "otp.breaker":
      return `🚧 مدار محافظ پیامک فعال شد (${escapeHtml(str(payload, "state") || "نرخ بالا")})`;
    case "admin.login": {
      const who = escapeHtml(str(payload, "staffName")) || maskPhone(str(payload, "phone"));
      const ip = escapeHtml(str(payload, "ipSlash24") || str(payload, "ip"));
      return `🔑 ورود مدیر — ${who}${ip ? ` — ${ip}` : ""}`;
    }
    case "backup.result": {
      const ok = payload.ok === true;
      return ok ? `💾 پشتیبان‌گیری موفق` : `❌ پشتیبان‌گیری ناموفق: ${escapeHtml(str(payload, "error"))}`;
    }
    case "security.alert":
      return `⚠️ هشدار امنیتی: ${escapeHtml(str(payload, "event") || str(payload, "kind"))}${payload.count ? ` × ${faInt(Number(payload.count))}` : ""}`;
    default:
      return `ℹ️ ${escapeHtml(String(kind))}`;
  }
}
