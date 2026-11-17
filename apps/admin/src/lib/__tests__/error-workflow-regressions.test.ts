import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldErrorsFromDetails, fieldErrorsFromIssues, readableErrorText } from "../error-detail";

describe("actionable admin error regressions", () => {
  it("distinguishes a supplied wrong type from a missing required value using real Zod issues", () => {
    const input = { price: "not a number" };
    const parsed = z.object({ price: z.number() }).safeParse(input);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const fields = fieldErrorsFromIssues(parsed.error.issues, input);
    expect(fields[0]?.path).toBe("price");
    expect(fields[0]?.message).toContain("عدد");
    expect(fields[0]?.message).not.toContain(input.price);
  });

  it("explains a service-level missing announcement end date instead of losing its reason", () => {
    const details = { field: "endsAt", reason: "required" };
    const fields = fieldErrorsFromDetails(details);
    expect(fields[0]?.path).toBe("endsAt");
    const text = readableErrorText({ code: "VALIDATION", reason: "VALIDATION", message: "اطلاعات ارسال‌شده معتبر نیست.", details });
    expect(text).toContain("پایان");
    expect(text).toMatch(/لازم|وارد|مشخص/);
  });

  it("includes the actual field correction for existing toast-only screens", () => {
    const text = readableErrorText({ code: "VALIDATION", reason: "FIELD_VALIDATION", details: { fieldErrors: [{ path: "price", message: "مقدار باید دست‌کم ۱۰۰۰ باشد" }] } });
    expect(text).toContain("قیمت");
    expect(text).toContain("۱۰۰۰");
  });
});
