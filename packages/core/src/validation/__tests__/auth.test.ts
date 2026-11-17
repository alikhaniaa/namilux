import { describe, expect, it } from "vitest";
import { GENDERS, OTP_CODE_LEN, OTP_PURPOSES } from "../../constants";
import {
  otpCodeSchema,
  otpPurposeSchema,
  otpRequestSchema,
  otpVerifySchema,
  phoneChangeRequestSchema,
  phoneChangeVerifySchema,
  phoneSchema,
  powTokenSchema,
  profileSchema,
} from "../auth";

const PHONE = "09121230077";

describe("primitives", () => {
  it("phoneSchema normalizes and otpCodeSchema is exactly OTP_CODE_LEN digits", () => {
    expect(phoneSchema.parse("+98 912 123 0077")).toBe(PHONE);
    expect(otpCodeSchema.parse("۱۲۳۴۵۶")).toBe("123456");
    expect(OTP_CODE_LEN).toBe(6);
    expect(() => otpCodeSchema.parse("12345")).toThrow();
    expect(() => otpCodeSchema.parse("1234567")).toThrow();
  });

  it("otpPurposeSchema is the constants enum and powTokenSchema is bounded", () => {
    for (const p of OTP_PURPOSES) expect(otpPurposeSchema.parse(p)).toBe(p);
    expect(() => otpPurposeSchema.parse("signup")).toThrow();
    expect(powTokenSchema.parse("x".repeat(16))).toBe("x".repeat(16));
    expect(() => powTokenSchema.parse("x".repeat(15))).toThrow();
    expect(() => powTokenSchema.parse("x".repeat(2049))).toThrow();
  });
});

describe("otp request/verify fold digits and reject unknown keys", () => {
  it("folds a Persian phone on request", () => {
    expect(otpRequestSchema.parse({ phone: "۰۹۱۲۱۲۳۰۰۷۷", purpose: "login" })).toEqual({
      phone: PHONE,
      purpose: "login",
    });
    expect(otpRequestSchema.parse({ phone: PHONE, purpose: "checkout", powToken: "p".repeat(20) }).powToken).toBe(
      "p".repeat(20),
    );
  });

  it("rejects unknown keys, prototype keys and a client-supplied identity", () => {
    expect(() => otpRequestSchema.parse({ phone: PHONE, purpose: "login", extra: 1 })).toThrow();
    expect(() => otpRequestSchema.parse({ phone: PHONE, purpose: "login", customerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toThrow();
    expect(() => otpRequestSchema.parse({ phone: PHONE, purpose: "login", code: "123456" })).toThrow();
    // an own "__proto__" property (only reachable via JSON.parse) is dropped, never assigned
    const polluted = JSON.parse(`{"phone":"${PHONE}","purpose":"login","__proto__":{"admin":true}}`) as unknown;
    const parsed = otpRequestSchema.parse(polluted);
    expect(parsed).toEqual({ phone: PHONE, purpose: "login" });
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
    expect(() => otpRequestSchema.parse(JSON.parse(`{"phone":"${PHONE}","purpose":"login","constructor":1}`))).toThrow();
  });

  it("verifies with a folded code and a purpose", () => {
    expect(otpVerifySchema.parse({ phone: PHONE, code: "۱۲۳۴۵۶", purpose: "checkout" })).toEqual({
      phone: PHONE,
      code: "123456",
      purpose: "checkout",
    });
    expect(() => otpVerifySchema.parse({ phone: PHONE, code: "12345", purpose: "checkout" })).toThrow();
    expect(() => otpVerifySchema.parse({ phone: PHONE, code: "123456" })).toThrow();
    expect(() => otpVerifySchema.parse({ phone: "02155550000", code: "123456", purpose: "login" })).toThrow();
    expect(() => otpVerifySchema.parse({ phone: PHONE, code: "123456", purpose: "login", attempts: 0 })).toThrow();
  });

  it("phone change request/verify are the same primitives, strict", () => {
    expect(phoneChangeRequestSchema.parse({ phone: "۰۹۱۲۱۲۳۰۰۷۷" })).toEqual({ phone: PHONE });
    expect(phoneChangeVerifySchema.parse({ phone: PHONE, code: "۱۲۳۴۵۶" })).toEqual({ phone: PHONE, code: "123456" });
    expect(() => phoneChangeRequestSchema.parse({ phone: PHONE, purpose: "verify_phone" })).toThrow();
    expect(() => phoneChangeVerifySchema.parse({ phone: PHONE })).toThrow();
  });
});

describe("profile bounds and birthday range", () => {
  it("accepts a minimal profile and trims the names", () => {
    expect(profileSchema.parse({ firstName: " علی ", lastName: "رضایی" })).toEqual({
      firstName: "علی",
      lastName: "رضایی",
    });
    expect(
      profileSchema.parse({
        firstName: "علی",
        lastName: "رضایی",
        email: null,
        birthday: null,
        gender: "male",
        marketingOptIn: true,
      }),
    ).toEqual({ firstName: "علی", lastName: "رضایی", email: null, birthday: null, gender: "male", marketingOptIn: true });
    for (const g of GENDERS) {
      expect(profileSchema.parse({ firstName: "علی", lastName: "رضایی", gender: g }).gender).toBe(g);
    }
  });

  it("enforces name bounds and rejects an empty email (null clears it)", () => {
    expect(() => profileSchema.parse({ firstName: "ع", lastName: "رضایی" })).toThrow();
    expect(() => profileSchema.parse({ firstName: "علی", lastName: "ر" })).toThrow();
    expect(() => profileSchema.parse({ firstName: "a".repeat(41), lastName: "رضایی" })).toThrow();
    expect(() => profileSchema.parse({ firstName: "علی", lastName: "رضایی", email: "" })).toThrow();
    expect(profileSchema.parse({ firstName: "علی", lastName: "رضایی", email: " A@B.IR " }).email).toBe("a@b.ir");
    expect(() => profileSchema.parse({ firstName: "علی", lastName: "رضایی", gender: "unknown" })).toThrow();
    expect(() => profileSchema.parse({ firstName: "علی", lastName: "رضایی", marketingOptIn: "yes" })).toThrow();
  });

  it("takes only a Gregorian birthday in the past and at or after 1900-01-01", () => {
    expect(profileSchema.parse({ firstName: "علی", lastName: "رضایی", birthday: "1990-03-21" }).birthday).toBe(
      "1990-03-21",
    );
    expect(profileSchema.parse({ firstName: "علی", lastName: "رضایی", birthday: "1900-01-01" }).birthday).toBe(
      "1900-01-01",
    );
    for (const bad of ["2030-01-01", "1899-12-31", "1369-01-01T00:00:00Z", "not-a-date", "1990/03/21"]) {
      expect(
        () => profileSchema.parse({ firstName: "علی", lastName: "رضایی", birthday: bad }),
        bad,
      ).toThrow();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(() => profileSchema.parse({ firstName: "علی", lastName: "رضایی", birthday: today })).toThrow();
  });

  it("is strict - the client never sets its own id, tier, points or phone", () => {
    for (const extra of [
      { customerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      { tier: "gold" },
      { pointsBalance: 10_000 },
      { phone: PHONE },
      { isBlocked: false },
    ]) {
      expect(() => profileSchema.parse({ firstName: "علی", lastName: "رضایی", ...extra }), JSON.stringify(extra)).toThrow();
    }
  });
});
