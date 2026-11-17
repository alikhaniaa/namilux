import { describe, expect, it } from "vitest";
import { csrfCheck, issueCsrf } from "../../apps/admin/src/lib/csrf";

const BASE = (process.env["E2E_BASE_URL"] ?? "").replace(/\/$/, "");
const ADMIN = (process.env["E2E_ADMIN_URL"] ?? "").replace(/\/$/, "");

describe.skipIf(BASE === "")("csrf — storefront", () => {
  it("cross-site POST to /api/me/cart is rejected", async () => {
    const crossSite = await fetch(`${BASE}/api/me/cart/`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ lines: [] }),
    });
    expect(crossSite.status).toBe(403);
    const body = (await crossSite.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");

    // a same-origin request without a session passes the origin gate and fails on auth instead
    const sameOrigin = await fetch(`${BASE}/api/auth/logout/`, { method: "POST", headers: { origin: BASE, "sec-fetch-site": "same-origin" } });
    expect(sameOrigin.status).toBe(401);

    // a wrong Origin fails even when Sec-Fetch-Site is missing (older clients)
    const wrongOrigin = await fetch(`${BASE}/api/auth/logout/`, { method: "POST", headers: { origin: "https://evil.example" } });
    expect(wrongOrigin.status).toBe(403);
  });
});

describe("csrf - admin double submit", () => {
  const req = (headers: Record<string, string>): Request => new Request("http://localhost:3100/api/products/bulk-price", { method: "POST", headers });

  it("admin write without x-nl-csrf is rejected", () => {
    const { value } = issueCsrf();
    expect(csrfCheck(req({}))).toBe(false);
    expect(csrfCheck(req({ cookie: `nl_c=${value}` }))).toBe(false); // cookie alone
    expect(csrfCheck(req({ "x-nl-csrf": value }))).toBe(false); // header alone
    expect(csrfCheck(req({ "x-nl-csrf": value, cookie: `nl_c=${value.slice(0, -1)}x` }))).toBe(false); // mismatch
    expect(csrfCheck(req({ "x-nl-csrf": "", cookie: "nl_c=" }))).toBe(false); // empty pair
    expect(csrfCheck(req({ "x-nl-csrf": value, cookie: `other=1; nl_c=${value}; nl_s=abc` }))).toBe(true);
    expect(issueCsrf().sameSite).toBe("strict");
    expect(issueCsrf().value).not.toBe(value); // fresh token per issue
  });

  it.skipIf(ADMIN === "")("the admin edge refuses anonymous writes before any handler runs", async () => {
    const res = await fetch(`${ADMIN}/api/products/bulk-price?dryRun=1`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ADMIN, "sec-fetch-site": "same-origin" },
      body: "{}",
      redirect: "manual",
    });
    expect([401, 403]).toContain(res.status);
    const get = await fetch(`${ADMIN}/api/products?q=x`, { redirect: "manual" });
    expect([401, 302, 307]).toContain(get.status);
  });
});
