import type { EventType, UaClass } from "@namilux/core/client";
import { isStandalone } from "@/components/pwa/standalone";
import { KEYS } from "./storage-keys";

const SESSION_TOKEN_KEY = "nl.s";
const E2E_FLAG_KEY = "nl.e2e.analytics";
const MAX_PROPS = 10;

function enabled(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (navigator.webdriver) {
    try {
      return sessionStorage.getItem(E2E_FLAG_KEY) === "1";
    } catch {
      return false;
    }
  }
  return true;
}

/** 16 hex chars, minted once per tab; a page reload keeps it, a new tab starts fresh. */
function sessionToken(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (existing !== null && /^[0-9a-f]{16}$/.test(existing)) return existing;
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    return token;
  } catch {
    return "0000000000000000";
  }
}

function uaClass(): UaClass {
  if (isStandalone()) return "pwa";
  const ua = navigator.userAgent;
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|Telegram/i.test(ua)) return "inapp";
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
}

/** Path without query/hash, except `?q=` on /search/ and `?page=` on listings (core record rules). */
function beaconPath(): string {
  const u = new URL(window.location.href);
  const keep = new URLSearchParams();
  const q = u.searchParams.get("q");
  const page = u.searchParams.get("page");
  if (u.pathname === "/search/" && q !== null) keep.set("q", q.slice(0, 80));
  if (page !== null && /^\d{1,4}$/.test(page)) keep.set("page", page);
  const qs = keep.toString();
  return qs === "" ? u.pathname : `${u.pathname}?${qs}`;
}

export function captureUtm(): void {
  try {
    if (sessionStorage.getItem(KEYS.utm) !== null) return;
    const u = new URL(window.location.href);
    const utm: Record<string, string> = {};
    for (const [k, v] of u.searchParams) {
      if (k === "source") utm.source = v.slice(0, 120);
      else if (k.startsWith("utm_")) utm[k.slice(4).replace(/[^a-z0-9_]/g, "").slice(0, 32)] = v.slice(0, 120);
    }
    if (Object.keys(utm).length > 0) sessionStorage.setItem(KEYS.utm, JSON.stringify(utm));
  } catch {
    /* storage unavailable: the visit simply has no source */
  }
}

function utmProps(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEYS.utm);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function track(type: EventType, props?: Record<string, string | number>): void {
  try {
    if (!enabled()) return;
    const x: Record<string, string | number> = { ...utmProps() };
    let pid: number | undefined;
    for (const [k, v] of Object.entries(props ?? {})) {
      if (k === "pid" && typeof v === "number" && Number.isInteger(v) && v > 0) {
        pid = v;
        continue;
      }
      if (!/^[a-z0-9_]{1,32}$/.test(k)) continue;
      if (Object.keys(x).length >= MAX_PROPS) break;
      x[k] = typeof v === "string" ? v.slice(0, 120) : v;
    }
    const ref = document.referrer === "" ? undefined : document.referrer.slice(0, 512);
    const body = JSON.stringify({
      t: type,
      p: beaconPath(),
      ...(ref === undefined ? {} : { r: ref }),
      ...(pid === undefined ? {} : { pid }),
      s: sessionToken(),
      ua: uaClass(),
      ...(Object.keys(x).length === 0 ? {} : { x }),
    });
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/e/", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/e/", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => undefined);
  } catch {
    /* a beacon must never surface as an error */
  }
}

export function pageview(): void {
  track("pv");
}
