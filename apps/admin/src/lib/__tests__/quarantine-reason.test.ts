import { describe, expect, it } from "vitest";

import { quarantineReasonFa } from "../quarantine-reason";

/**
 * The strings under test are the ones `packages/seed/src/images/quarantine.ts` actually writes, and
 * the ones the live media table holds: the two-clause form is what 26 of the 545 rows on the box
 * carried on 9 Sep 2026.
 */
describe("quarantineReasonFa", () => {
  it("translates every reason the importer can write", () => {
    expect(quarantineReasonFa("full-bleed frame (bbox 100%)")).toBe("قاب بدون حاشیه (٪۱۰۰)");
    expect(quarantineReasonFa("coloured border (sat 0.191)")).toBe("حاشیهٔ رنگی (۰٫۱۹۱)");
    expect(quarantineReasonFa("aspect 0.42")).toBe("نسبت ابعاد ۰٫۴۲");
    expect(quarantineReasonFa("empty after trim")).toBe("بعد از برش چیزی نماند");
  });

  it("joins the clauses the importer separates with a semicolon", () => {
    expect(quarantineReasonFa("full-bleed frame (bbox 97%); coloured border (sat 0.075)")).toBe(
      "قاب بدون حاشیه (٪۹۷)، حاشیهٔ رنگی (۰٫۰۷۵)",
    );
  });

  it("leaves no Latin digit behind", () => {
    const out = quarantineReasonFa("full-bleed frame (bbox 100%); coloured border (sat 0.964)") ?? "";
    expect(out).not.toMatch(/[0-9]/);
    expect(out).not.toMatch(/[A-Za-z]/);
  });

  it("passes an unknown reason through rather than swallowing it", () => {
    expect(quarantineReasonFa("something new the importer learned")).toBe("something new the importer learned");
  });

  it("has nothing to say about an absent reason", () => {
    expect(quarantineReasonFa(null)).toBeNull();
    expect(quarantineReasonFa(undefined)).toBeNull();
    expect(quarantineReasonFa("   ")).toBeNull();
  });
});
