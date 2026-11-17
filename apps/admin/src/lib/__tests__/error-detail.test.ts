import { describe, expect, it } from "vitest";
import { ERROR_REASONS, fieldErrorsFromDetails, fieldErrorsFromIssues, fieldLabel, readableErrorText } from "../error-detail";

/**
 * The redaction rules, on their own: a message that carries anything the caller sent, an English
 * Zod default, or a caller-chosen key must never leave the server.
 */
describe("fieldErrorsFromIssues - safe Persian field errors", () => {
  it("translates the common issue codes with Persian copy and the existing label", () => {
    const errors = fieldErrorsFromIssues(
      [
        { code: "invalid_type", path: ["price"], expected: "number", input: "SECRET-VALUE", message: "Invalid input: expected number, received string" },
        { code: "too_small", path: ["displayName"], origin: "string", minimum: 2, inclusive: true, message: "Too small: expected string to have >=2 characters" },
        { code: "too_big", path: ["stockQty"], origin: "number", maximum: 10, inclusive: true, message: "Too big" },
        { code: "invalid_format", path: ["slug"], format: "regex", message: "Invalid string" },
      ],
      {},
    );

    expect(errors.map((e) => e.path)).toEqual(["price", "displayName", "stockQty", "slug"]);
    expect(errors.map((e) => e.message)).toEqual([
      "مقدار این فیلد باید عدد باشد",
      "تعداد نویسه‌ها باید دست‌کم ۲ باشد",
      "مقدار باید حداکثر ۱۰ باشد",
      "قالب این مقدار درست نیست",
    ]);
    expect(errors[0]?.label).toBe("قیمت");
    expect(errors[1]?.label).toBe("نام محصول");
    expect(JSON.stringify(errors)).not.toContain("SECRET-VALUE");
    expect(JSON.stringify(errors)).not.toContain("Invalid input");
  });

  it("reads a missing key as required", () => {
    const errors = fieldErrorsFromIssues([{ code: "invalid_type", path: ["name"], expected: "string", input: undefined, message: "Required" }]);
    expect(errors[0]?.message).toBe("این فیلد لازم است");
  });

  it("keeps a hand-written Persian message", () => {
    const errors = fieldErrorsFromIssues([{ code: "custom", path: ["code"], message: "این کد تخفیف قبلاً استفاده شده است" }]);
    expect(errors[0]?.message).toBe("این کد تخفیف قبلاً استفاده شده است");
  });

  it("drops a message that repeats a value the caller sent, even a Persian one", () => {
    const input = { name: "نام‌محرمانه", slug: "SECRET-SLUG-123" };
    const errors = fieldErrorsFromIssues(
      [
        { code: "custom", path: ["name"], message: "نام‌محرمانه تکراری است" },
        { code: "custom", path: ["slug"], message: "مقدار SECRET-SLUG-123 پذیرفته نشد" },
      ],
      input,
    );
    expect(errors[0]?.message).toBe("مقدار این فیلد پذیرفته نشد");
    expect(errors[1]?.message).toBe("مقدار این فیلد پذیرفته نشد");
    expect(JSON.stringify(errors)).not.toContain("نام‌محرمانه");
    expect(JSON.stringify(errors)).not.toContain("SECRET-SLUG-123");
  });

  it("never echoes a caller-chosen key", () => {
    const errors = fieldErrorsFromIssues([
      { code: "unrecognized_keys", path: [], keys: ["isActive"], message: "Unrecognized key" },
      { code: "invalid_key", path: ["مشتری-ویژه"], message: "Invalid key" },
    ]);
    expect(errors.map((e) => e.path)).toEqual(["", ""]);
    expect(JSON.stringify(errors)).not.toContain("isActive");
    expect(JSON.stringify(errors)).not.toContain("مشتری-ویژه");
  });

  it("reports a nested array path and stays bounded", () => {
    const issues = Array.from({ length: 40 }, (_, i) => ({ code: "invalid_type", path: ["lines", i, "qty"], expected: "number", input: null, message: "Bad" }));
    const errors = fieldErrorsFromIssues(issues, {});
    expect(errors.length).toBeLessThanOrEqual(20);
    expect(errors[0]?.path).toBe("lines.0.qty");
  });
});

describe("fieldErrorsFromDetails - reading a response back", () => {
  it("accepts details.fieldErrors and the bare core issue array", () => {
    expect(fieldErrorsFromDetails({ fieldErrors: [{ path: "price", message: "مقدار معتبر نیست" }] })[0]).toEqual({
      path: "price",
      message: "مقدار معتبر نیست",
      label: "قیمت",
    });
    expect(fieldErrorsFromDetails([{ path: "lines.0.qty", message: "مقدار معتبر نیست." }])[0]?.path).toBe("lines.0.qty");
  });

  it("ignores anything else, and refuses a caller-shaped path", () => {
    expect(fieldErrorsFromDetails(undefined)).toEqual([]);
    expect(fieldErrorsFromDetails({ sudoRequired: true, permission: "staff.manage" })).toEqual([]);
    // A path that is not schema-shaped is dropped; the message still reaches the summary.
    expect(fieldErrorsFromDetails({ fieldErrors: [{ path: "../../etc/passwd", message: "مقدار معتبر نیست" }] })).toEqual([
      { path: "", message: "مقدار معتبر نیست" },
    ]);
  });
});

describe("fieldLabel", () => {
  it("names the fields the panel already names", () => {
    expect(fieldLabel("price")).toBe("قیمت");
    expect(fieldLabel("lines.0.price")).toBe("قیمت (ردیف ۱)");
    expect(fieldLabel("title")).toBe("عنوان");
    expect(fieldLabel("messages.2.endsAt")).toBe("تاریخ پایان (ردیف ۳)");
    expect(fieldLabel("someUnknownField")).toBeUndefined();
  });
});

describe("service {field, reason} details", () => {
  it("turns known reasons into a correction, with the bound but never the value", () => {
    const href = fieldErrorsFromDetails({ field: "ctaHref", reason: "unsafe_href", href: "javascript:SECRET" });
    expect(href.map((f) => [f.path, f.label])).toEqual([["ctaHref", "لینک دکمه"]]);
    expect(href[0]?.message).toContain("https://");
    expect(JSON.stringify(href)).not.toContain("SECRET");
    const long = fieldErrorsFromDetails({ field: "items.1.label", reason: "too_long", max: 24, key: "SECRET-KEY" });
    expect(long[0]?.label).toBe("عنوان (ردیف ۲)");
    expect(long[0]?.message).toContain("۲۴");
    expect(JSON.stringify(long)).not.toContain("SECRET");
    expect(fieldErrorsFromDetails({ field: "endsAt", reason: "invalid_window" })[0]?.message).toContain("بعد از تاریخ شروع");
  });

  it("does not invent a cause for an unknown reason, but keeps it in the diagnostic", () => {
    const details = { field: "slug", reason: "brand_new_rule" };
    expect(fieldErrorsFromDetails(details)[0]?.message).toBe("مقدار این فیلد پذیرفته نشد؛ آن را بررسی و اصلاح کنید.");
    const text = readableErrorText({ code: "VALIDATION", reason: "VALIDATION", ref: "r-2", details });
    expect(text).toContain("نشانی صفحه در سایت");
    expect(text).not.toContain("brand_new_rule");
    expect(text).toContain("پیگیری: r-2");
  });

  it("ignores details with no field or a reason that is not a plain code", () => {
    expect(fieldErrorsFromDetails({ field: "id" })).toEqual([]);
    expect(fieldErrorsFromDetails({ reason: "instalment_ineligible", productIds: [7] })).toEqual([]);
    expect(fieldErrorsFromDetails({ field: "title", reason: "<b>SECRET</b>" })).toEqual([]);
  });
});

describe("readableErrorText", () => {
  it("adds the recovery, the fields to fix and the diagnostic pair", () => {
    const text = readableErrorText({
      code: "FORBIDDEN",
      message: "اعتبار امنیتی این صفحه منقضی شده است.",
      reason: ERROR_REASONS.CSRF_EXPIRED,
      ref: "r-1",
      details: { fieldErrors: [{ path: "price", message: "مقدار باید دست‌کم ۰ باشد" }] },
    });
    expect(text).toContain("اعتبار امنیتی این صفحه منقضی شده است.");
    expect(text).toContain("صفحه را دوباره بارگذاری کنید");
    expect(text).toContain("موردهای نیازمند اصلاح: قیمت");
    expect(text).not.toContain("FORBIDDEN");
    expect(text).not.toContain("CSRF_EXPIRED");
    expect(text).toContain("پیگیری: r-1");
  });

  it("keeps a service's own message without repeating it as a field line, and caps the list", () => {
    const own = "تاریخ پایان باید بعد از تاریخ شروع باشد.";
    const text = readableErrorText({
      code: "VALIDATION",
      message: own,
      reason: "VALIDATION",
      details: { field: "endsAt", reason: "invalid_window", fieldErrors: [{ path: "endsAt", message: own }] },
    });
    expect(text.split("بعد از تاریخ شروع").length).toBe(2);
    expect(text).not.toContain("invalid_window");

    const many = readableErrorText({
      code: "VALIDATION",
      reason: "FIELD_VALIDATION",
      details: { fieldErrors: ["a", "b", "c", "d", "e"].map((p) => ({ path: p, message: `پیام ${p}` })) },
    });
    expect(many).toContain("پیام a");
    expect(many).not.toContain("پیام d");
    expect(many).toContain("۲ مورد دیگر");
    expect(readableErrorText({ code: "VALIDATION", details: { fieldErrors: [{ path: "price", message: "پیام" }] } }, { withFields: false })).not.toContain("پیام");
  });

  it("falls back to the core copy for a code with no message, and tolerates an unknown reason", () => {
    expect(readableErrorText({ code: "UNAUTHORIZED" })).toContain("برای ادامه باید وارد حساب خود شوید.");
    const unknown = readableErrorText({ code: "CONFLICT", message: "این عملیات در وضعیت فعلی ممکن نیست.", reason: "SOMETHING_NEW" });
    expect(unknown).toContain("این عملیات در وضعیت فعلی ممکن نیست.");
    expect(unknown).not.toContain("SOMETHING_NEW");
  });
});
