import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../apps/web/src/security/headers";
import { adminHeaders } from "../../apps/admin/src/security/headers";

function csp(headers: { key: string; value: string }[]): string {
  return headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
}
const THIRD_PARTY_ALLOWED = ["trustseal.enamad.ir", "logo.samandehi.ir", "payment.zarinpal.com", "sandbox.zarinpal.com"];

describe("security/headers - storefront", () => {
  it("cached CSP: default-src self, no host outside the seal/gateway allow-list", () => {
    const value = csp(securityHeaders("cached", undefined, true));
    expect(value).toContain("default-src 'self'");
    const hosts = value.match(/https?:\/\/[^\s;]+/g) ?? [];
    for (const h of hosts) expect(THIRD_PARTY_ALLOWED.some((a) => h.includes(a))).toBe(true);
  });
  it("nonce CSP carries the nonce and strict-dynamic (dynamic routes)", () => {
    const value = csp(securityHeaders("nonce", "abc123", true));
    expect(value).toContain("'nonce-abc123'");
    expect(value).toContain("'strict-dynamic'");
  });
  it("HSTS preload present on https", () => {
    expect(securityHeaders("cached", undefined, true).some((h) => h.key === "Strict-Transport-Security" && h.value.includes("preload"))).toBe(true);
  });
});

describe("security/headers - admin", () => {
  it("admin is noindex + no-store, nonce+strict-dynamic, frame-ancestors none, no gateway form-action", () => {
    const headers = adminHeaders("nnn", "https://namilux.ir");
    expect(headers.some((h) => h.key === "X-Robots-Tag" && h.value.includes("noindex"))).toBe(true);
    expect(headers.some((h) => h.key === "Cache-Control" && h.value.includes("no-store"))).toBe(true);
    const value = csp(headers);
    expect(value).toContain("'nonce-nnn'");
    expect(value).toContain("frame-ancestors 'none'");
    expect(value).not.toContain("zarinpal");
    expect(value).toContain("upgrade-insecure-requests");
    // plain-http dev: no upgrade, or WebKit turns every chunk into https://localhost and never hydrates
    expect(csp(adminHeaders("nnn", "http://localhost:3000"))).not.toContain("upgrade-insecure-requests");
  });
});
