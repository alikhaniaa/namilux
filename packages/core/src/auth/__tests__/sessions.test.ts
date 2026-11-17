import { describe, expect, it } from "vitest";
import { SESSION_COOKIE_OPTIONS, hashToken, newSessionToken, uaClass } from "../sessions";

describe("auth/sessions - pure", () => {
  it("cookie flags match the spec", () => {
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 15_552_000,
    });
  });

  it("newSessionToken returns 43 base64url chars and 1000 are unique", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const t = newSessionToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(1000);
  });

  it("hashToken is stable, 64 hex chars, and pepper-sensitive", () => {
    const a = hashToken("a", "p");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("a", "p")).toBe(a);
    expect(hashToken("a", "q")).not.toBe(a);
  });

  it("uaClass table", () => {
    expect(uaClass("Instagram 250.0.0")).toBe("inapp");
    expect(uaClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile")).toBe("mobile");
    expect(uaClass("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe("desktop");
    expect(uaClass("")).toBe("desktop");
  });
});
