import { describe, expect, it } from "vitest";

import {
  cleanLabel,
  cleanText,
  excerptFrom,
  fixArabicLetters,
  hasLatinDigits,
} from "../zwnj";

describe("seed display text cleaning", () => {
  it("idempotent", () => {
    const values = [
      "ویژگی ها",
      "می شود",
      "سرخ کن های تفال",
      "روش هاى پرداخت 1300 وات",
      "dyson hs08",
      "\u0000نام‌‌ها",
    ];

    for (const value of values) {
      expect(cleanText(cleanText(value))).toBe(cleanText(value));
    }

    expect(cleanText("ویژگی ها")).toBe("ویژگی‌ها");
    expect(cleanText("می شود")).toBe("می‌شود");
    expect(cleanText("سرخ کن های")).toBe("سرخ‌کن‌های");
  });

  it("arabic letters fixed", () => {
    expect(fixArabicLetters("روش هاى پرداخت با ي و ك و ە")).toBe(
      "روش های پرداخت با ی و ک و ه",
    );
    expect(cleanText("روش هاى پرداخت")).toBe("روش‌های پرداخت");
  });

  it("digits folded except model codes", () => {
    expect(cleanText("1300 وات")).toBe("۱۳۰۰ وات");
    expect(cleanText("dyson hs08")).toBe("dyson hs08");
    expect(cleanText("ECF03 نحوه")).toBe("ECF03 نحوه");
    expect(cleanText("4.5 سانتی متر")).toBe("۴.۵ سانتی متر");
    expect(hasLatinDigits("۱۳۰۰ وات")).toBe(false);
    expect(hasLatinDigits("1300 وات")).toBe(true);
    expect(hasLatinDigits("dyson hs08")).toBe(false);
  });


  it("label trailing colon removed", () => {
    expect(cleanLabel(" اقلام همراه: ")).toBe("اقلام همراه");
    expect(cleanLabel("ویژگی ها：")).toBe("ویژگی‌ها");
  });


  it("excerpt short input no ellipsis", () => {
    expect(excerptFrom("<p>متن کوتاه</p>", 240)).toBe("متن کوتاه");
    expect(excerptFrom("   ", 240)).toBe("");
  });
});
