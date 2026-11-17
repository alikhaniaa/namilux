import { describe, expect, it } from "vitest";
import { CATEGORY_STATUSES, SMS_TEMPLATES } from "@namilux/core/client";
import { categoryStatusLabel, fa, smsTemplateLabel } from "../fa";

/**
 * The panel is Persian; a screen that prints an enum member is a bug, not a shortcut. These are the
 * two lists whose raw keys reached the 7 Sep 2026 walkthrough - «order.paid» in the order detail's
 * SMS picker, «active» in the category editor's «وضعیت» dropdown - so each list is asserted whole:
 * add a template or a status without a Persian name and this fails.
 */
const LATIN = /[A-Za-z0-9]/;

describe("fa labels", () => {
  it("uses Persian punctuation without long dashes", () => {
    expect(Object.entries(fa).filter(([, value]) => /[—–]|\s،/.test(value))).toEqual([]);
  });
  it("every SMS template has a Persian name and none falls back to its key", () => {
    for (const template of SMS_TEMPLATES) {
      const label = smsTemplateLabel(template);
      expect(label, template).not.toBe(template);
      expect(LATIN.test(label), `${template} → ${label}`).toBe(false);
    }
  });

  it("every category status has a Persian name and none falls back to its key", () => {
    for (const status of CATEGORY_STATUSES) {
      const label = categoryStatusLabel(status);
      expect(label, status).not.toBe(status);
      expect(LATIN.test(label), `${status} → ${label}`).toBe(false);
    }
  });

  it("unknown keys have a Persian fallback", () => {
    expect(smsTemplateLabel("order.not_a_template")).toBe("قالب پیامک");
    expect(categoryStatusLabel("toString")).toBe("وضعیت نامشخص");
  });

  it("the step-up prompt the staff screen names is the one the dialog shows", () => {
    expect(fa["sudo.title"]).toBe("تأیید دوباره");
  });
});
