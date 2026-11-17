import { describe, expect, it } from "vitest";
import { redirectTarget, requestOrigin } from "../request-origin";

describe("canonical reverse-proxy origin", () => {
  const internal = new URL("http://127.0.0.1:3000/shop/?sort=price_asc");
  it("uses the public HTTPS origin behind a trusted proxy", () => {
    expect(requestOrigin(internal, new Headers({ host: "203.0.113.10", "x-forwarded-host": "203.0.113.10", "x-forwarded-proto": "https" }), true)).toEqual({ host: "203.0.113.10", protocol: "https:" });
  });
  it("ignores spoofed forwarded headers when proxy trust is disabled", () => {
    expect(requestOrigin(internal, new Headers({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }), false)).toEqual({ host: "127.0.0.1:3000", protocol: "http:" });
  });
  it("never retains the internal port and preserves the path/query", () => {
    expect(redirectTarget("203.0.113.10", "https:", internal.pathname, internal.search).href).toBe("https://203.0.113.10/shop/?sort=price_asc");
  });
  it("retains an explicitly configured nonstandard public port", () => {
    expect(redirectTarget("localhost:3000", "http:", "/shop/", "").href).toBe("http://localhost:3000/shop/");
  });
  it("treats a double-slash pathname as a path, not another origin", () => {
    expect(redirectTarget("namilux.ir", "https:", "//evil.example/", "").origin).toBe("https://namilux.ir");
  });
});
