import { describe, expect, it } from "vitest";
import { MAX_CART_LINES, MAX_QTY_PER_LINE, MAX_WISHLIST_ITEMS } from "../../constants";
import {
  cancelOrderSchema,
  cartLineSchema,
  cartLinesSchema,
  cartSyncSchema,
  couponCodeSchema,
  orderCodeParamSchema,
  orderCodeSchema,
  placeRequestSchema,
  quoteAddressRefSchema,
  quoteRequestSchema,
  retryPaymentSchema,
  returnRequestSchema,
  shippingKeySchema,
  trackRequestSchema,
  wishlistSyncSchema,
} from "../checkout";

const SIG = "a1b2c3d4".repeat(8); // 64 hex chars
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const lines = [{ productId: 1044, qty: 1 }];

describe("quote lines bounds and folding", () => {
  it("accepts a single line and folds Persian numerals", () => {
    expect(quoteRequestSchema.parse({ lines })).toEqual({ lines });
    expect(cartLineSchema.parse({ productId: "۱۰۴۴", qty: "۲" })).toEqual({ productId: 1044, qty: 2 });
    expect(cartLinesSchema.parse([{ productId: 1, qty: MAX_QTY_PER_LINE }])[0]?.qty).toBe(99);
  });

  it("rejects an empty cart, an over-long cart, duplicates and out-of-range quantities", () => {
    expect(() => cartLinesSchema.parse([])).toThrow();
    const tooMany = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({ productId: i + 1, qty: 1 }));
    expect(() => cartLinesSchema.parse(tooMany)).toThrow();
    expect(cartLinesSchema.parse(tooMany.slice(0, MAX_CART_LINES)).length).toBe(MAX_CART_LINES);
    expect(() =>
      cartLinesSchema.parse([
        { productId: 1, qty: 1 },
        { productId: 1, qty: 2 },
      ]),
    ).toThrow();
    for (const qty of [0, -1, 100, 1.5, "abc", null]) {
      expect(() => cartLineSchema.parse({ productId: 1, qty }), JSON.stringify(qty)).toThrow();
    }
    for (const productId of [0, -1, "abc", null, 2_147_483_648]) {
      expect(() => cartLineSchema.parse({ productId, qty: 1 }), JSON.stringify(productId)).toThrow();
    }
  });

  it("never accepts a price, a name, an image or a stock field on a line", () => {
    for (const extra of [
      { price: 1 },
      { unitPrice: 1 },
      { compareAt: 2 },
      { displayName: "کتری" },
      { stockQty: 99 },
      { discount: 100 },
      { image: "/x.jpg" },
    ]) {
      expect(() => cartLineSchema.parse({ productId: 1, qty: 1, ...extra }), JSON.stringify(extra)).toThrow();
    }
    for (const extra of [{ subtotal: 1 }, { total: 1 }, { discount: 1 }, { shippingCost: 0 }, { customerId: ULID }]) {
      expect(() => quoteRequestSchema.parse({ lines, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });

  it("takes the optional quote inputs and validates the shipping key", () => {
    expect(
      quoteRequestSchema.parse({ lines, couponCode: "welcome10", usePoints: true, shippingKey: "free_nationwide" }),
    ).toEqual({ lines, couponCode: "WELCOME10", usePoints: true, shippingKey: "free_nationwide" });
    expect(shippingKeySchema.parse("express_tehran")).toBe("express_tehran");
    for (const bad of ["A", "1free", "free-nationwide", "f", "free nationwide", `a${"b".repeat(40)}`]) {
      expect(() => shippingKeySchema.parse(bad), bad).toThrow();
    }
  });
});

describe("coupon code normalization", () => {
  it("folds, trims and uppercases", () => {
    expect(couponCodeSchema.parse(" welcome10 ")).toBe("WELCOME10");
    expect(couponCodeSchema.parse("nowruz۱۴۰۵")).toBe("NOWRUZ1405");
  });

  it("rejects punctuation, short codes and over-long codes", () => {
    for (const bad of ["nl-welcome", "abc", "welcome 10", "welcome_10", "کد‌تخفیف", "A".repeat(33), "", 10]) {
      expect(() => couponCodeSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(couponCodeSchema.parse("A".repeat(32)).length).toBe(32);
  });
});

describe("address ref union", () => {
  it("accepts a saved-address ULID or a province/city pair", () => {
    expect(quoteAddressRefSchema.parse(ULID)).toBe(ULID);
    expect(quoteAddressRefSchema.parse({ province: "THR", city: "تهران" })).toEqual({
      province: "THR",
      city: "تهران",
    });
    expect(quoteRequestSchema.parse({ lines, addressId: { province: "THR", city: "تهران" } }).addressId).toEqual({
      province: "THR",
      city: "تهران",
    });
  });

  it("rejects an unknown province, a partial pair and an extra key", () => {
    expect(() => quoteAddressRefSchema.parse({ province: "XX", city: "تهران" })).toThrow();
    expect(() => quoteAddressRefSchema.parse({ province: "THR" })).toThrow();
    expect(() => quoteAddressRefSchema.parse({ province: "THR", city: "تهران", postcode: "1391654321" })).toThrow();
    expect(() => quoteAddressRefSchema.parse("not-a-ulid")).toThrow();
    expect(() => quoteAddressRefSchema.parse(1)).toThrow();
  });
});

describe("place requires exactly one address form and a 64-hex sig", () => {
  const base = { quoteSig: SIG, lines, shippingKey: "free_nationwide", paymentMethod: "zarinpal" as const };
  const address = {
    recipientName: "علی رضایی",
    recipientPhone: "09121230077",
    province: "THR",
    city: "تهران",
    address: "خیابان ولیعصر، پلاک ۱۲",
    postcode: "1391654321",
  };

  it("accepts a saved address id", () => {
    const parsed = placeRequestSchema.parse({ ...base, addressId: ULID });
    expect(parsed.addressId).toBe(ULID);
    expect(parsed.address).toBeUndefined();
  });

  it("accepts an inline address and validates it with addressSchema", () => {
    const parsed = placeRequestSchema.parse({ ...base, address });
    expect(parsed.address?.city).toBe("تهران");
    expect(parsed.address?.label).toBe("خانه");
    expect(() => placeRequestSchema.parse({ ...base, address: { ...address, city: "تبریز" } })).toThrow();
  });

  it("refuses both address forms, neither form, a bad sig and a non-web payment method", () => {
    const both = placeRequestSchema.safeParse({ ...base, addressId: ULID, address });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(["addressId"]);
    expect(placeRequestSchema.safeParse(base).success).toBe(false);
    for (const sig of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "", "z".repeat(64)]) {
      expect(() => placeRequestSchema.parse({ ...base, quoteSig: sig, addressId: ULID }), sig).toThrow();
    }
    for (const method of ["manual", "card_to_card", "installments", "cash", ""]) {
      expect(() => placeRequestSchema.parse({ ...base, paymentMethod: method, addressId: ULID }), method).toThrow();
    }
    expect(() => placeRequestSchema.parse({ ...base, addressId: ULID, shippingKey: undefined })).toThrow();
  });

  it("takes an optional note and gift message, and refuses a price or a coupon amount", () => {
    const parsed = placeRequestSchema.parse({
      ...base,
      addressId: ULID,
      note: " لطفاً پیش از ارسال تماس بگیرید ",
      gift: { message: "تولدت مبارک" },
      couponCode: "welcome10",
      usePoints: true,
    });
    expect(parsed.note).toBe("لطفاً پیش از ارسال تماس بگیرید");
    expect(parsed.gift).toEqual({ message: "تولدت مبارک" });
    expect(parsed.couponCode).toBe("WELCOME10");
    expect(() => placeRequestSchema.parse({ ...base, addressId: ULID, note: "x".repeat(501) })).toThrow();
    expect(() => placeRequestSchema.parse({ ...base, addressId: ULID, gift: { message: "x".repeat(301) } })).toThrow();
    expect(() => placeRequestSchema.parse({ ...base, addressId: ULID, gift: { message: "x", wrap: true } })).toThrow();
    for (const extra of [{ total: 1 }, { discount: 5000 }, { shippingCost: 0 }, { pointsUsed: 900 }, { orderCode: "NL-7Q2F4" }]) {
      expect(() => placeRequestSchema.parse({ ...base, addressId: ULID, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });
});

describe("track code normalization", () => {
  it("folds, trims and uppercases the order code", () => {
    expect(trackRequestSchema.parse({ code: "nl-7q2f4", phone: "۰۹۱۲۱۲۳۰۰۷۷" })).toEqual({
      code: "NL-7Q2F4",
      phone: "09121230077",
    });
    expect(orderCodeSchema.parse(" nl-7q2f4 ")).toBe("NL-7Q2F4");
    expect(orderCodeParamSchema.parse({ code: "NL-7Q2F4" })).toEqual({ code: "NL-7Q2F4" });
  });

  it("rejects an ambiguous character, a wrong prefix and a wrong length", () => {
    for (const bad of ["NL-7Q2F0", "NL-7Q2FO", "NL-7Q2FI", "NL-7Q2FL", "NL-7Q2F", "NL-7Q2F45", "XX-7Q2F4", "7Q2F4", ""]) {
      expect(() => orderCodeSchema.parse(bad), bad).toThrow();
    }
    expect(() => trackRequestSchema.parse({ code: "NL-7Q2F4" })).toThrow();
    expect(() => trackRequestSchema.parse({ code: "NL-7Q2F4", phone: "02155550000" })).toThrow();
    expect(() => trackRequestSchema.parse({ code: "NL-7Q2F4", phone: "09121230077", email: "a@b.ir" })).toThrow();
  });
});

describe("cart/wishlist sync", () => {
  it("accepts an empty cart sync and requires an ISO timestamp with an offset", () => {
    expect(cartSyncSchema.parse({ lines: [], updatedAt: "2026-08-25T10:00:00.000Z" })).toEqual({
      lines: [],
      updatedAt: "2026-08-25T10:00:00.000Z",
    });
    expect(cartSyncSchema.parse({ lines, updatedAt: "2026-08-25T10:00:00+03:30" }).lines).toEqual(lines);
    expect(() => cartSyncSchema.parse({ lines: [], updatedAt: "2026-08-25" })).toThrow();
    expect(() => cartSyncSchema.parse({ lines: [] })).toThrow();
    expect(() =>
      cartSyncSchema.parse({
        lines: [
          { productId: 1, qty: 1 },
          { productId: 1, qty: 1 },
        ],
        updatedAt: "2026-08-25T10:00:00.000Z",
      }),
    ).toThrow();
    const tooMany = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({ productId: i + 1, qty: 1 }));
    expect(() => cartSyncSchema.parse({ lines: tooMany, updatedAt: "2026-08-25T10:00:00.000Z" })).toThrow();
  });

  it("caps the wishlist and refuses duplicates", () => {
    const ids = Array.from({ length: MAX_WISHLIST_ITEMS }, (_, i) => i + 1);
    expect(wishlistSyncSchema.parse({ ids }).ids.length).toBe(MAX_WISHLIST_ITEMS);
    expect(wishlistSyncSchema.parse({ ids: [] })).toEqual({ ids: [] });
    expect(() => wishlistSyncSchema.parse({ ids: [...ids, MAX_WISHLIST_ITEMS + 1] })).toThrow();
    expect(() => wishlistSyncSchema.parse({ ids: [1, 1] })).toThrow();
    expect(() => wishlistSyncSchema.parse({ ids: [0] })).toThrow();
    expect(() => wishlistSyncSchema.parse({ ids: [1], updatedAt: "2026-08-25T10:00:00.000Z" })).toThrow();
  });
});

describe("return/cancel", () => {
  it("returnRequestSchema needs a code and a reason of at least ten characters", () => {
    expect(
      returnRequestSchema.parse({ orderCode: "nl-7q2f4", reason: "کالا با تصویر سایت تفاوت دارد" }),
    ).toEqual({ orderCode: "NL-7Q2F4", reason: "کالا با تصویر سایت تفاوت دارد" });
    expect(
      returnRequestSchema.parse({ orderCode: "NL-7Q2F4", reason: "کالا آسیب دیده است", items: lines }).items,
    ).toEqual(lines);
    expect(() => returnRequestSchema.parse({ orderCode: "NL-7Q2F4", reason: "خرابه" })).toThrow();
    expect(() => returnRequestSchema.parse({ orderCode: "NL-7Q2F4", reason: "x".repeat(501) })).toThrow();
    expect(() =>
      returnRequestSchema.parse({
        orderCode: "NL-7Q2F4",
        reason: "کالا آسیب دیده است",
        items: [
          { productId: 1, qty: 1 },
          { productId: 1, qty: 1 },
        ],
      }),
    ).toThrow();
    expect(() => returnRequestSchema.parse({ orderCode: "NL-7Q2F4", reason: "کالا آسیب دیده", refund: 1000 })).toThrow();
  });

  it("cancelOrderSchema and retryPaymentSchema take the code only", () => {
    expect(cancelOrderSchema.parse({ orderCode: "nl-7q2f4" })).toEqual({ orderCode: "NL-7Q2F4" });
    expect(cancelOrderSchema.parse({ orderCode: "NL-7Q2F4", reason: "نظرم عوض شد" }).reason).toBe("نظرم عوض شد");
    expect(() => cancelOrderSchema.parse({ orderCode: "NL-7Q2F4", reason: "x".repeat(301) })).toThrow();
    expect(retryPaymentSchema.parse({ orderCode: "NL-7Q2F4" })).toEqual({ orderCode: "NL-7Q2F4" });
    expect(() => retryPaymentSchema.parse({ orderCode: "NL-7Q2F4", amount: 1000 })).toThrow();
    expect(() => retryPaymentSchema.parse({})).toThrow();
  });
});
