import { describe, expect, it } from "vitest";
import { DEFAULT_SMS_TEMPLATES, PATTERN_VAR_LIMITS, REQUIRED_VARS, SITE_VAR, assertTemplate, namesSite, renderTemplate, sitePatternKey, truncateVar } from "../templates";
import type { SmsTemplate } from "@namilux/core/constants";

/** Every `{placeholder}` in a body, in order. */
function placeholdersOf(body: string): string[] {
  return [...body.matchAll(/\{(\w+)\}/gu)].map((m) => m[1] as string);
}

/**
 * Which variable each order-code-carrying pattern declares it under. Two names, on purpose: the
 * patterns approved on 7 Sep 2026 use `code`, and the three rebuilt that evening use `sefaresh` because
 * their reviewer turns anything called `code` into a 6-digit int.
 */
const ORDER_CODE_VAR = [
  ["order.placed_pending", "sefaresh"],
  ["order.expired", "sefaresh"],
  ["order.cancelled", "sefaresh"],
  ["order.paid", "code"],
  ["order.shipped", "code"],
  ["order.delivered", "code"],
  ["return.received", "code"],
] as const satisfies readonly (readonly [SmsTemplate, string])[];

describe("sms/templates", () => {
  it("every default template is ≤ 2 segments", () => {
    for (const key of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplate[]) {
      expect(() => assertTemplate(DEFAULT_SMS_TEMPLATES[key])).not.toThrow();
    }
  });

  it("numbers become Persian digits, the fixed addresses stay Latin", () => {
    const { text } = renderTemplate("order.placed_pending", { sefaresh: "NL-7Q2F4", site: "namilux.ir" });
    expect(text).toContain("NL-7Q2F4");
    expect(text).toContain("namilux.ir/account");
    const paid = renderTemplate("order.paid", { code: "NL-1", eta: 3 });
    expect(paid.text).toContain("۳");
  });

  it("missing variable renders empty and does not throw", () => {
    const { text } = renderTemplate("order.cancelled", { sefaresh: "NL-1" });
    expect(text).toContain("NL-1");
  });

  it("assertTemplate rejects a 3-segment text", () => {
    expect(() => assertTemplate("ا".repeat(200))).toThrow();
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - what the rebuilt patterns actually declare (7 Sep 2026)

  it("no body asks for a variable its pattern no longer has", () => {
    // FarazSMS rejected every pattern that took a URL as a variable, and the free-form `note` on
    // order.cancelled. A body that still printed one would send a variable the pattern cannot fill.
    for (const key of Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplate[]) {
      if (key === "birthday.coupon") continue; // free text for good - its link may stay
      expect(placeholdersOf(DEFAULT_SMS_TEMPLATES[key])).not.toContain("url");
    }
    expect(placeholdersOf(DEFAULT_SMS_TEMPLATES["order.cancelled"]).filter((v) => v !== SITE_VAR)).toEqual(["sefaresh"]);
  });

  it("REQUIRED_VARS matches the pattern variable sets registered in the panel", () => {
    expect(REQUIRED_VARS).toMatchObject({
      otp: ["code"],
      "order.placed_pending": ["sefaresh"],
      "order.paid": ["code", "eta"],
      "order.shipped": ["code", "carrier", "tracking"],
      "order.delivered": ["code"],
      "order.expired": ["sefaresh"],
      "order.cancelled": ["sefaresh"],
      "product.back_in_stock": ["name"],
      "concierge.reply": ["name"],
      "contact.reply": ["answer"],
      "return.received": ["code"],
      "loyalty.tier_up": ["tier", "benefits"],
      // 95DOACyydm has no variables at all, which is not the same as having no pattern.
      "customer.welcome": [],
    });
  });

  it("every body prints exactly the variables its pattern declares", () => {
    for (const [key, vars] of Object.entries(REQUIRED_VARS) as [SmsTemplate, string[]][]) {
      if (key === "campaign") continue; // never registered; bulk marketing is meant to be moderated
      // {site} is filled from the storefront and is never sent as a pattern attribute
      expect(new Set(placeholdersOf(DEFAULT_SMS_TEMPLATES[key]).filter((v) => v !== SITE_VAR))).toEqual(new Set(vars));
    }
  });

  it("a limit is declared for every variable of every pattern-backed template", () => {
    for (const [key, vars] of Object.entries(REQUIRED_VARS) as [SmsTemplate, string[]][]) {
      const limits = PATTERN_VAR_LIMITS[key];
      if (limits === undefined) continue; // birthday.coupon and campaign have no pattern
      expect(Object.keys(limits).sort()).toEqual([...vars].sort());
    }
    // The order code is NL-XXXXX - 8 characters - so no pattern that carries one may declare less,
    // under whichever name that pattern gives it.
    for (const [key, name] of ORDER_CODE_VAR) {
      expect(PATTERN_VAR_LIMITS[key]?.[name]).toBeGreaterThanOrEqual(8);
      expect(REQUIRED_VARS[key]).toContain(name);
      expect(placeholdersOf(DEFAULT_SMS_TEMPLATES[key])).toContain(name);
    }
  });

  it("the three rebuilt order patterns do not call the order code `code`", () => {
    // FarazSMS's reviewer reads a variable named `code` as a one-time password and rewrites it to a
    // 6-digit int - on the originals, on the replacements, and again on a third round filed under
    // category 3, which they moved back to category 1 first. `sefaresh` was approved at str 10
    // untouched. If this name drifts back the message silently returns to the moderation queue.
    for (const key of ["order.placed_pending", "order.expired", "order.cancelled"] as const) {
      expect(Object.keys(PATTERN_VAR_LIMITS[key] ?? {})).toEqual(["sefaresh"]);
      expect(placeholdersOf(DEFAULT_SMS_TEMPLATES[key])).not.toContain("code");
    }
  });

  it("concierge.reply points at the account area instead of carrying a 25-character stub", () => {
    // DIy15ksqcV declares `name` alone. `answer` would come back capped at 25 by their reviewer,
    // and the only route that could carry a whole reply - free text - is the moderated one that
    // gets rejected. The درخواست‌ها tab at namilux.ir/account already shows the reply in full.
    const { text } = renderTemplate("concierge.reply", { site: "namilux.ir", name: "کتری برقی" });
    expect(text).toContain("کتری برقی");
    expect(text).toContain("namilux.ir/account");
    expect(placeholdersOf(DEFAULT_SMS_TEMPLATES["concierge.reply"])).toEqual(["name", SITE_VAR]);
    expect(PATTERN_VAR_LIMITS["concierge.reply"]).toEqual({ name: 25 });
  });

  it("customer.welcome renders with no variables at all", () => {
    const { text } = renderTemplate("customer.welcome", { site: "namilux.ir" });
    expect(text).toBe(DEFAULT_SMS_TEMPLATES["customer.welcome"].replace("{site}", "namilux.ir"));
    expect(text).toContain("namilux.ir/account");
  });

  it("rendered for namilux.ir, the bodies still print the addresses the main patterns hold", () => {
    // {site} replaced the literal address on 15 Sep 2026; for the main site nothing changed.
    expect(renderTemplate("order.shipped", { code: "NL-7Q2F4", carrier: "post", tracking: "RB1", site: "namilux.ir" }).text).toContain("namilux.ir/track");
    expect(renderTemplate("order.expired", { sefaresh: "NL-7Q2F4", site: "namilux.ir" }).text).toContain("namilux.ir/account");
  });

  it("only the messages that print an address have an instalment-site pattern", () => {
    const naming = (Object.keys(DEFAULT_SMS_TEMPLATES) as SmsTemplate[]).filter(namesSite).sort();
    expect(naming).toEqual(["concierge.reply", "customer.welcome", "order.cancelled", "order.expired", "order.placed_pending", "order.shipped"]);
    expect(sitePatternKey("order.shipped", "instalments")).toBe("order.shipped@instalments");
    expect(sitePatternKey("order.shipped", "main")).toBe("order.shipped");
    // no address in it: the same words on both sites, so the main pattern serves both
    expect(sitePatternKey("order.paid", "instalments")).toBe("order.paid");
    expect(renderTemplate("order.placed_pending", { sefaresh: "NL-7Q2F4", site: "namilux2.ir" }).text).not.toMatch(/(^|[^\w])namilux\.ir/u);
  });

  it("truncateVar cuts to the declared length, ellipsis included", () => {
    expect(truncateVar("سلام", 10)).toBe("سلام");
    expect(truncateVar("0123456789", 10)).toBe("0123456789"); // exactly at the limit is not cut
    expect(truncateVar("01234567890", 10)).toBe("012345678…");
    expect(truncateVar("01234567890", 10)).toHaveLength(10);
    // Code points, not UTF-16 units: an emoji must not be cut in half into a lone surrogate.
    expect([...truncateVar("🌸🌸🌸🌸", 3)]).toEqual(["🌸", "🌸", "…"]);
    expect(truncateVar("abc", 1)).toBe("a");
    expect(truncateVar("abc", 0)).toBe("");
  });
});
