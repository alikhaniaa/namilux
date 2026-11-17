import { describe, expect, it } from "vitest";

import {
  DISPLAY_NAME_MAX,
  buildDisplayName,
  nameLooksLikeScrape,
  typeFromName,
} from "../display-name";

describe("display-name drafts", () => {
  it("canonical example", () => {
    const input = {
      name: "کتری برقی درجه دار اسمگ KLF04BL",
      brandFa: "اسمگ",
      typeFa: "کتری برقی",
      modelCode: "KLF04BL",
      colorName: "مشکی براق",
    };
    const result = buildDisplayName(input);
    expect(result).toEqual({
      displayName: "اسمگ کتری برقی KLF04BL · مشکی براق",
      draft: false,
      reasons: [],
    });
    expect(buildDisplayName({ ...input, name: result.displayName }).displayName).toBe(
      result.displayName,
    );
  });

  it("dyson example", () => {
    expect(
      buildDisplayName({
        name: "ایرپ دیفیوزر 08 رنگ ردولوت dyson hs08",
        brandFa: "دایسون",
        typeFa: "استایلر و ایرپ",
        modelCode: "HS08",
        colorName: "ردولوت",
      }).displayName,
    ).toBe("دایسون استایلر و ایرپ HS08 · ردولوت");
  });

  it("type from scrape name", () => {
    const name = "tefal masterchop xxl خردکن تفال یک و نیم لیتری رنگ مشکی";
    expect(typeFromName(name)).toBe("خردکن یک و نیم لیتری");
    expect(
      buildDisplayName({
        name,
        brandFa: "تفال",
        typeFa: null,
        modelCode: null,
        colorName: "مشکی",
      }),
    ).toEqual({
      displayName: "تفال خردکن یک و نیم لیتری · مشکی",
      draft: true,
      reasons: ["type-from-name", "no-model"],
    });
    expect(nameLooksLikeScrape(name)).toBe(true);
    expect(nameLooksLikeScrape("اسمگ SMEG کتری KLF04")).toBe(true);
    expect(nameLooksLikeScrape("اسمگ کتری KLF04 رنگ مشکی")).toBe(true);
    expect(nameLooksLikeScrape("اسمگ کتری برقی KLF04")).toBe(false);
  });

  it("missing parts flagged", () => {
    expect(
      buildDisplayName({
        name: "قابلمه و تابه",
        brandFa: null,
        typeFa: "قابلمه و تابه",
        modelCode: null,
        colorName: null,
      }),
    ).toEqual({
      displayName: "قابلمه و تابه",
      draft: true,
      reasons: ["no-brand", "no-model"],
    });
  });

  it("shortens type not model", () => {
    const result = buildDisplayName({
      name: "محصول",
      brandFa: "اسمگ",
      typeFa: "دستگاه حرفه‌ای بسیار پیشرفته برای آشپزخانه‌های مدرن امروزی",
      modelCode: "KLF04BLEU",
      colorName: "مشکی براق",
    });
    expect(result.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
    expect(result.displayName).toContain("KLF04BLEU");
    expect(result.reasons).toContain("shortened");
    expect(result.displayName).not.toContain("…");
  });

  it("colour dropped last", () => {
    const result = buildDisplayName({
      name: "محصول",
      brandFa: "اسمگ",
      typeFa: null,
      modelCode: "KLF04BLEU",
      colorName: "رنگی با نام بسیار بسیار بسیار طولانی و غیرعادی برای آزمون نهایی",
    });
    expect(result.displayName).toBe("اسمگ KLF04BLEU");
    expect(result.reasons).toContain("colour-dropped");
  });

  it("digit folding with guard", () => {
    const result = buildDisplayName({
      name: "محصول",
      brandFa: "برند 2",
      typeFa: "همزن 1300 وات",
      modelCode: "KLF04",
      colorName: null,
    });
    expect(result.displayName).toBe("برند ۲ همزن ۱۳۰۰ وات KLF04");
  });

  it("never exceeds 60", () => {
    const cases = [
      buildDisplayName({
        name: "محصول",
        brandFa: "دایسون",
        typeFa: "وسیله بسیار بسیار طولانی برای استفاده روزمره در آشپزخانه خانه",
        modelCode: "HS08",
        colorName: "رد ولوت",
      }),
      buildDisplayName({
        name: "اسمگ کتری برقی KLF04 · مشکی براق",
        brandFa: "اسمگ",
        typeFa: "کتری برقی",
        modelCode: "KLF04",
        colorName: "مشکی براق",
      }),
    ];
    for (const result of cases) {
      expect(result.displayName.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
      expect(result.displayName).not.toMatch(/[!！]|(?:^|\s)(?:رنگ|مدل|new)(?:\s|$)/iu);
    }
    expect(cases[1]?.displayName).toBe("اسمگ کتری برقی KLF04 · مشکی براق");
  });
});
