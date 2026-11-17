import { describe, expect, it } from "vitest";
import { INTERNAL_REVALIDATE_PATH, internalRevalidateTarget } from "../internal-target";

/**
 * The shape the cache flip has to have. It failed in production as «revalidate http 404» because it
 * was addressed to the public origin, where Caddy blocks /api/internal/*; and it would fail again,
 * silently, if the loopback call arrived without the canonical host - the storefront's proxy reads
 * x-forwarded-host and answers 301 to SITE_ORIGIN when it differs.
 */
describe("internalRevalidateTarget", () => {
  it("posts over loopback, never at the public origin", () => {
    const t = internalRevalidateTarget("http://127.0.0.1:3000", "https://namilux.ir");
    expect(t.url).toBe("http://127.0.0.1:3000/api/internal/revalidate/");
    expect(t.url).not.toContain("namilux.ir");
  });

  it("carries the public host and https so the canonical-host redirect does not fire", () => {
    const t = internalRevalidateTarget("http://127.0.0.1:3000", "https://namilux.ir");
    expect(t.headers).toEqual({
      host: "namilux.ir",
      "x-forwarded-host": "namilux.ir",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "127.0.0.1",
    });
  });

  it("keeps the port in the host - the instalment site lives on one", () => {
    const t = internalRevalidateTarget("http://127.0.0.1:3300", "https://203.0.113.20:8200");
    expect(t.url).toBe("http://127.0.0.1:3300/api/internal/revalidate/");
    expect(t.headers.host).toBe("203.0.113.20:8200");
    expect(t.headers["x-forwarded-host"]).toBe("203.0.113.20:8200");
  });

  it("mirrors an http origin (dev) rather than claiming https", () => {
    expect(internalRevalidateTarget("http://127.0.0.1:3000", "http://localhost:3000").headers["x-forwarded-proto"]).toBe("http");
  });

  it("never doubles the slash between base and path", () => {
    expect(internalRevalidateTarget("http://127.0.0.1:3000/", "https://namilux.ir").url).toBe(`http://127.0.0.1:3000${INTERNAL_REVALIDATE_PATH}`);
  });

  it("keeps the trailing slash the storefront redirects to (next.config trailingSlash: true)", () => {
    expect(INTERNAL_REVALIDATE_PATH.endsWith("/")).toBe(true);
  });
});
