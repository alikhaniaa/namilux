import { describe, expect, it } from "vitest";

import {
  iranPhoneToE164,
  isIranMobile,
  isPostcode,
  maskPhone,
  normalizePhone,
  normalizePostcode,
  phoneDisplay,
  phoneToE164,
} from "../phone";

describe("persian/phone", () => {
  it("normalizePhone accepts the four input forms", () => {
    const table: [string, string][] = [
      ["۰۹۱۲۱۲۳۰۰۷۷", "09121230077"],
      ["09121230077", "09121230077"],
      ["+98 912 123 0077", "09121230077"],
      ["0098-912-1230077", "09121230077"],
      ["9121230077", "09121230077"],
      ["989121230077", "09121230077"],
      ["09121230077 ", "09121230077"],
      ["(0912) 123.0077", "09121230077"],
      ["٠٩١٢١٧٥٤٩٧٧", "09121230077"],
      ["09901234567", "09901234567"],
      ["09301234567", "09301234567"],
    ];
    for (const [input, expected] of table) {
      expect(normalizePhone(input)).toBe(expected);
      expect(isIranMobile(input)).toBe(true);
    }
  });

  it("normalizePhone rejects landlines, lengths and non-mobile prefixes", () => {
    const table = [
      "02155550000",
      "0912123007",
      "091212300777",
      "09521230077",
      "09421230077",
      "abc",
      "",
      "+1 415 555 0132",
      "0912-123-007a",
      "۰۹۱۲۱۲۳۰۰۷",
    ];
    for (const input of table) {
      expect(normalizePhone(input)).toBeNull();
      expect(isIranMobile(input)).toBe(false);
    }
  });

  it("maskPhone", () => {
    expect(maskPhone("09121230077")).toBe("0912***0077");
    expect(maskPhone("۰۹۱۲۱۲۳۰۰۷۷")).toBe("0912***0077");
    expect(maskPhone("bad")).toBe("***");
    expect(maskPhone("")).toBe("***");
    expect(maskPhone("0912123007")).toBe("***");
    expect(maskPhone("09121230077")).not.toContain("175");
  });

  it("phoneToE164", () => {
    expect(phoneToE164("09121230077")).toBe("+989121230077");
    expect(() => phoneToE164("9121230077")).toThrow(RangeError);
    expect(() => phoneToE164("۰۹۱۲۱۲۳۰۰۷۷")).toThrow(RangeError);
    expect(() => phoneToE164("")).toThrow(RangeError);
  });

  it("phoneDisplay", () => {
    expect(phoneDisplay("09121230077")).toBe("۰۹۱۲ ۱۲۳ ۰۰۷۷");
    expect(phoneDisplay("۰۹۱۲۱۲۳۰۰۷۷")).toBe("۰۹۱۲ ۱۲۳ ۰۰۷۷");
    expect(phoneDisplay("")).toBe("");
    expect(phoneDisplay("09121230077")).not.toMatch(/[0-9]/);
  });

  it("isPostcode table", () => {
    const table: [string, boolean][] = [
      ["۱۳۹۱۶۵۴۳۲۱", true],
      ["13916-54321", true],
      ["1391654321", true],
      ["13916 54321", true],
      ["139165432", false],
      ["13916543210", false],
      ["1391654321a", false],
      ["", false],
    ];
    for (const [input, expected] of table) expect(isPostcode(input)).toBe(expected);
    expect(normalizePostcode("۱۳۹۱۶-۵۴۳۲۱")).toBe("1391654321");
    expect(normalizePostcode("139165432")).toBeNull();
  });
});

// The gap the contact page reported: `phoneToE164` only ever accepted a normalized mobile, so the
// shop's own landline had no URL builder and «۰۲۱۵۵۵۵۰۰۰۰» was printed as inert text.
describe("persian/phone - iranPhoneToE164 (landline included)", () => {
  it("dials the landline the shop actually publishes", () => {
    expect(iranPhoneToE164("02155550000")).toBe("+982155550000");
    expect(iranPhoneToE164("۰۲۱ ۵۵۵۵۰۰۰۰")).toBe("+982155550000");
    expect(iranPhoneToE164("021-5555-0000")).toBe("+982155550000");
  });

  it("agrees with phoneToE164 on every mobile form", () => {
    for (const form of ["09121230077", "+98 912 123 0077", "0098-912-1230077", "۰۹۱۲۱۲۳۰۰۷۷"]) {
      expect(iranPhoneToE164(form)).toBe("+989121230077");
    }
  });

  it("answers null instead of throwing - every caller is a render path over free-text settings", () => {
    for (const bad of ["", "   ", "info@namilux.ir", "تماس", "021", "00"]) {
      expect(iranPhoneToE164(bad)).toBeNull();
    }
  });
});
