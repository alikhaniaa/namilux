import { describe, expect, it } from "vitest";
import {
  backInStockSchema,
  conciergeReplySchema,
  conciergeSchema,
  contactSchema,
  inboxAssignSchema,
  inboxSnoozeSchema,
  newsletterSchema,
  productIdParamSchema,
  questionAnswerSchema,
  questionSchema,
} from "../requests";

const PHONE = "09121230077";
const POW = "pow-token-solution-payload";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("back-in-stock and concierge", () => {
  it("takes a phone alone, or a phone plus the inline OTP code", () => {
    expect(backInStockSchema.parse({ phone: PHONE })).toEqual({ phone: PHONE });
    expect(backInStockSchema.parse({ phone: "۰۹۱۲۱۲۳۰۰۷۷", code: "۱۲۳۴۵۶" })).toEqual({
      phone: PHONE,
      code: "123456",
    });
    expect(() => backInStockSchema.parse({ phone: PHONE, code: "12345" })).toThrow();
    expect(() => backInStockSchema.parse({ phone: "02155550000" })).toThrow();
    expect(() => backInStockSchema.parse({})).toThrow();
    // the product id comes from the path, never from the body
    expect(() => backInStockSchema.parse({ phone: PHONE, productId: 1044 })).toThrow();
  });

  it("concierge folds the product id and keeps an empty note", () => {
    expect(conciergeSchema.parse({ productId: "۱۰۴۴", phone: PHONE, note: "" })).toEqual({
      productId: 1044,
      phone: PHONE,
      note: "",
    });
    expect(conciergeSchema.parse({ productId: 1044, phone: PHONE, code: "۱۲۳۴۵۶" }).code).toBe("123456");
    expect(() => conciergeSchema.parse({ productId: 0, phone: PHONE })).toThrow();
    expect(() => conciergeSchema.parse({ productId: 1044, phone: PHONE, note: "x".repeat(501) })).toThrow();
    expect(() => conciergeSchema.parse({ productId: 1044, phone: PHONE, price: 41_500_000 })).toThrow();
  });
});

describe("question bounds", () => {
  it("needs 10 to 1000 characters of plain text", () => {
    expect(questionSchema.parse({ body: "آیا این کتری بی‌سیم است؟" }).body).toBe("آیا این کتری بی‌سیم است؟");
    expect(() => questionSchema.parse({ body: "کوتاه است" })).toThrow(); // 9 chars
    expect(questionSchema.parse({ body: "x".repeat(1000) }).body.length).toBe(1000);
    expect(() => questionSchema.parse({ body: "x".repeat(1001) })).toThrow();
    expect(() => questionSchema.parse({ body: "سؤال درست است", customerId: ULID })).toThrow();
    // control padding cannot buy the missing characters back
    expect(() => questionSchema.parse({ body: "سؤال" + "\u0000".repeat(20) })).toThrow();
  });
});

describe("contact requires pow", () => {
  it("rejects a body without a proof-of-work token", () => {
    expect(() =>
      contactSchema.parse({ name: "علی", phone: PHONE, message: "سلام، دربارهٔ گارانتی سؤال داشتم" }),
    ).toThrow();
    expect(() =>
      contactSchema.parse({ name: "علی", phone: PHONE, message: "سلام، سؤال داشتم دربارهٔ گارانتی", powToken: "short" }),
    ).toThrow();
  });

  it("cleans bidi overrides and control characters out of the message", () => {
    const RLO = "\u202E";
    const PDF = "\u202C";
    const NUL = "\u0000";
    const parsed = contactSchema.parse({
      name: " علی ",
      phone: "۰۹۱۲۱۲۳۰۰۷۷",
      message: `${RLO}سلام، دربارهٔ گارانتی${NUL} سؤال داشتم${PDF}`,
      powToken: POW,
    });
    expect(parsed).toEqual({
      name: "علی",
      phone: PHONE,
      message: "سلام، دربارهٔ گارانتی سؤال داشتم",
      powToken: POW,
    });
    // eslint-disable-next-line no-control-regex -- asserting the controls are gone
    expect(parsed.message).not.toMatch(/[\u0000-\u0008\u202A-\u202E\uFEFF]/);
    expect(() => contactSchema.parse({ name: "ع", phone: PHONE, message: "متن کافی است", powToken: POW })).toThrow();
    expect(() => contactSchema.parse({ name: "علی", phone: PHONE, message: "کوتاه", powToken: POW })).toThrow();
    expect(() =>
      contactSchema.parse({ name: "علی", phone: PHONE, message: "x".repeat(2001), powToken: POW }),
    ).toThrow();
    expect(() =>
      contactSchema.parse({ name: "علی", phone: PHONE, message: "متن کافی است", powToken: POW, email: "a@b.ir" }),
    ).toThrow();
  });
});

describe("newsletter literal true", () => {
  it("creates a row only from a checked box", () => {
    expect(newsletterSchema.parse({ phone: PHONE, optIn: true, powToken: POW })).toEqual({
      phone: PHONE,
      optIn: true,
      powToken: POW,
    });
    for (const optIn of [false, "true", 1, null, undefined]) {
      expect(() => newsletterSchema.parse({ phone: PHONE, optIn, powToken: POW }), JSON.stringify(optIn)).toThrow();
    }
    expect(() => newsletterSchema.parse({ phone: PHONE, optIn: true })).toThrow();
  });
});

describe("admin replies", () => {
  it("questionAnswerSchema defaults both switches to false", () => {
    expect(questionAnswerSchema.parse({ answer: "بله، بی‌سیم است." })).toEqual({
      answer: "بله، بی‌سیم است.",
      sendSms: false,
      promoteToFaq: false,
    });
    expect(questionAnswerSchema.parse({ answer: "بله", sendSms: true, promoteToFaq: true }).sendSms).toBe(true);
    expect(() => questionAnswerSchema.parse({ answer: "" })).toThrow();
    expect(() => questionAnswerSchema.parse({ answer: "x".repeat(2001) })).toThrow();
    expect(() => questionAnswerSchema.parse({ answer: "بله", status: "answered" })).toThrow();
  });

  it("conciergeReplySchema requires a positive price when publishPrice is set", () => {
    expect(conciergeReplySchema.parse({ message: "قیمت این مدل اعلام شد." })).toEqual({
      message: "قیمت این مدل اعلام شد.",
      publishPrice: false,
    });
    expect(
      conciergeReplySchema.parse({ message: "قیمت اعلام شد", price: "۴۱٬۵۰۰٬۰۰۰", publishPrice: true }),
    ).toEqual({ message: "قیمت اعلام شد", price: 41500000, publishPrice: true });

    const noPrice = conciergeReplySchema.safeParse({ message: "قیمت اعلام شد", publishPrice: true });
    expect(noPrice.success).toBe(false);
    expect(noPrice.error?.issues[0]?.path).toEqual(["price"]);
    expect(() => conciergeReplySchema.parse({ message: "قیمت", price: 0, publishPrice: true })).toThrow();
    expect(() => conciergeReplySchema.parse({ message: "قیمت", price: -1 })).toThrow();
    expect(() => conciergeReplySchema.parse({ message: "" })).toThrow();
    expect(() => conciergeReplySchema.parse({ message: "x".repeat(301) })).toThrow();
    // a price without publishPrice is only quoted over SMS
    expect(conciergeReplySchema.parse({ message: "قیمت", price: 41_500_000 }).publishPrice).toBe(false);
  });

  it("inbox assign/snooze and the product id param are strict", () => {
    expect(inboxAssignSchema.parse({ staffId: ULID })).toEqual({ staffId: ULID });
    expect(inboxAssignSchema.parse({ staffId: null })).toEqual({ staffId: null });
    expect(() => inboxAssignSchema.parse({ staffId: "1" })).toThrow();
    expect(() => inboxAssignSchema.parse({})).toThrow();
    expect(inboxSnoozeSchema.parse({ until: "2026-08-25T10:00:00.000Z" }).until).toBe("2026-08-25T10:00:00.000Z");
    expect(() => inboxSnoozeSchema.parse({ until: "2026-08-25" })).toThrow();
    expect(productIdParamSchema.parse({ id: "۱۰۴۴" })).toEqual({ id: 1044 });
    expect(() => productIdParamSchema.parse({ id: 0 })).toThrow();
    expect(() => productIdParamSchema.parse({ id: 1044, slug: "kettle" })).toThrow();
  });
});
