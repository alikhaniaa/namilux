import { describe, expect, it } from "vitest";
import { safeNext } from "../safe-next";

describe("safeNext", () => {
  it("drops everything that is not a same-origin path", () => {
    for (const bad of [null, undefined, "", "//evil.example", "/\\evil.example", "https://evil.example/x", "javascript:alert(1)", "/a b", "/x\n", "x/y"]) {
      expect(safeNext(bad)).toBe("/");
    }
    expect(safeNext(`/${"a".repeat(3000)}`)).toBe("/");
  });
  it("keeps a real path with its query and never loops back into the login pages", () => {
    expect(safeNext("/orders/ABC12?tab=notes")).toBe("/orders/ABC12?tab=notes");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext("/login/totp")).toBe("/");
  });
});
