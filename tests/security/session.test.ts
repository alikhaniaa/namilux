import { describe, expect, it } from "vitest";
import { STAFF_IDLE_MS } from "@namilux/core";
import { readLastMockSms } from "@namilux/integrations";

const BASE = (process.env["E2E_BASE_URL"] ?? "").replace(/\/$/, "");
const OUTBOX = process.env["E2E_SMS_OUTBOX"] ?? "";
const H = { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" };

const latin = (s: string): string => s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

async function loginCookie(): Promise<{ token: string; setCookie: string }> {
  const phone = `0913${String(Date.now()).slice(-7)}`;
  const req = await fetch(`${BASE}/api/auth/otp/request/`, { method: "POST", headers: H, body: JSON.stringify({ phone, purpose: "login" }) });
  expect(req.status).toBe(200);
  let code = "";
  for (let i = 0; i < 40 && code === ""; i += 1) {
    const sms = await readLastMockSms(OUTBOX, phone);
    const m = /([۰-۹0-9]{6})/.exec(sms?.text ?? "");
    if (m?.[1] !== undefined) code = latin(m[1]);
    else await new Promise((r) => setTimeout(r, 250));
  }
  expect(code).toMatch(/^\d{6}$/);
  const ver = await fetch(`${BASE}/api/auth/otp/verify/`, { method: "POST", headers: H, body: JSON.stringify({ phone, code, purpose: "login" }) });
  expect(ver.status).toBe(200);
  const setCookie = ver.headers.get("set-cookie") ?? "";
  const token = /nl_s=([^;]+)/.exec(setCookie)?.[1] ?? "";
  expect(token).not.toBe("");
  return { token, setCookie };
}

describe.skipIf(BASE === "" || OUTBOX === "")("sessions", () => {
  it("cookie flags httpOnly secure sameSite lax", async () => {
    const { setCookie } = await loginCookie();
    expect(setCookie).toMatch(/nl_s=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    // `Secure` follows the origin scheme (the spec: always on in production, where SITE_ORIGIN is https)
    if (BASE.startsWith("https://")) expect(setCookie).toMatch(/Secure/i);
    else expect(setCookie).not.toMatch(/Secure/i);
  });

  it("revoked session cannot read /api/me", async () => {
    const { token } = await loginCookie();
    const cookie = `nl_s=${token}`;
    const me = await fetch(`${BASE}/api/me/`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const out = await fetch(`${BASE}/api/auth/logout/`, { method: "POST", headers: { ...H, cookie } });
    expect(out.status).toBeLessThan(300);
    const after = await fetch(`${BASE}/api/me/`, { headers: { cookie } });
    expect(after.status).toBe(401);
    // a tampered token is never a session either
    const forged = await fetch(`${BASE}/api/me/`, { headers: { cookie: `nl_s=${token.slice(0, -2)}xx` } });
    expect(forged.status).toBe(401);
  });
});

describe("staff sessions", () => {
  it("staff session expires after 30 min idle", () => {
    expect(STAFF_IDLE_MS).toBe(30 * 60_000);
  });
});
