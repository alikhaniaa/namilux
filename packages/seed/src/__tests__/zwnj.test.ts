import { describe, expect, it } from "vitest";

import { cleanLabel, cleanText, excerptFrom, fixArabicLetters, hasLatinDigits, stripControl } from "../transform/zwnj.js";

const ZWNJ = "‌";

describe("idempotent", () => {
  const samples = [
    "ویژگی ها",
    "می شود",
    "سرخ کن های تفال",
    "کتری برقی درجه دار اسمگ KLF04BL",
    "1300 وات",
    "روش هاي پرداخت",
    "",
  ];

  it("cleanText(cleanText(s)) === cleanText(s)", () => {
    for (const s of samples) {
      const once = cleanText(s);
      expect(cleanText(once)).toBe(once);
    }
  });

  it("applies the core ZWNJ rules through the seed pass", () => {
    expect(cleanText("ویژگی ها")).toBe(`ویژگی${ZWNJ}ها`);
    expect(cleanText("می شود")).toBe(`می${ZWNJ}شود`);
    expect(cleanText("سرخ کن های")).toBe(`سرخ${ZWNJ}کن${ZWNJ}های`);
  });
});

describe("arabic letters fixed", () => {
  it("folds ي ى ك ە without touching digits, ZWNJ or Latin case", () => {
    expect(fixArabicLetters("روش هاي پرداخت")).toBe("روش های پرداخت");
    expect(fixArabicLetters("كتري")).toBe("کتری");
    expect(fixArabicLetters(`KLF04 ویژگی${ZWNJ}ها ۱۳۰۰`)).toBe(`KLF04 ویژگی${ZWNJ}ها ۱۳۰۰`);
  });

  it("cleanText fixes an Arabic yeh before the ZWNJ pass", () => {
    expect(cleanText("روش هاي پرداخت")).toBe(`روش${ZWNJ}های پرداخت`);
  });
});

describe("digits folded except model codes", () => {
  it("folds standalone digits and keeps Latin designators", () => {
    expect(cleanText("1300 وات")).toBe("۱۳۰۰ وات");
    expect(cleanText("dyson hs08")).toBe("dyson hs08");
    expect(cleanText("ECF03 نحوه")).toBe("ECF03 نحوه");
    expect(cleanText("3 سرعته")).toBe("۳ سرعته");
  });

  it("leaves the decimal separator alone (DECISION in the header)", () => {
    // "4.5 سانتی متر" → "۴.۵ …": faDigits never touches punctuation.
    expect(cleanText("4.5 سانتی متر").startsWith("۴.۵ ")).toBe(true);
    expect(cleanText("4.5 سانتی متر")).not.toMatch(/[0-9]/);
  });

  it("hasLatinDigits flags digits outside a Latin run only", () => {
    expect(hasLatinDigits("1300 وات")).toBe(true);
    expect(hasLatinDigits("KLF04BL مشکی")).toBe(false);
    expect(hasLatinDigits("۱۳۰۰ وات")).toBe(false);
    expect(hasLatinDigits("")).toBe(false);
  });
});

describe("control chars stripped", () => {
  it("removes control/BOM/replacement chars and collapses whitespace", () => {
    expect(stripControl("  a\u0000b\u007F  c\uFEFF\uFFFD  ")).toBe("ab c");
    expect(stripControl("a\tb\nc")).toBe("a b c");
  });

  it("keeps ZWNJ and collapses a doubled one through faZwnj", () => {
    expect(stripControl(`نام${ZWNJ}ها`)).toBe(`نام${ZWNJ}ها`);
    expect(cleanText(` نام${ZWNJ}${ZWNJ}ها`)).toBe(`نام${ZWNJ}ها`);
  });

  it("strips bidi overrides (DECISION: superset of the listed set)", () => {
    expect(stripControl("ali\u202Ereza")).toBe("alireza");
  });
});

describe("label trailing colon removed", () => {
  it("drops a trailing ASCII or fullwidth colon", () => {
    expect(cleanLabel("اقلام همراه:")).toBe("اقلام همراه");
    expect(cleanLabel("اقلام همراه：")).toBe("اقلام همراه");
    expect(cleanLabel(" ویژگی ها : ")).toBe(`ویژگی${ZWNJ}ها`);
  });

  it("keeps a colon that is not final", () => {
    expect(cleanLabel("لوازم جانبی شامل : تامپر")).toBe("لوازم جانبی شامل : تامپر");
  });
});

describe("excerpt word boundary", () => {
  it("cuts at a space boundary ≤ maxChars and appends an ellipsis", () => {
    const html = `<p>${"کلمه ".repeat(120).trim()}</p>`;
    const excerpt = excerptFrom(html, 240);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.slice(0, -1).length).toBeLessThanOrEqual(240);
    expect(excerpt.slice(0, -1).trimEnd()).toBe(excerpt.slice(0, -1));
    // never mid-word: every kept token is a whole word of the source
    for (const word of excerpt.slice(0, -1).split(" ")) expect(word).toBe("کلمه");
  });

  it("never leaves punctuation before the ellipsis", () => {
    const text = `${"یک دو سه، ".repeat(40)}`;
    const excerpt = excerptFrom(text, 60);
    expect(excerpt).toMatch(/…$/);
    expect(excerpt.slice(-2, -1)).not.toBe("،");
  });

  it("strips tags and decodes entities before cutting", () => {
    expect(excerptFrom("<p>سلام <strong>دنیا</strong></p>", 240)).toBe("سلام دنیا");
    expect(excerptFrom("<p>a&nbsp;b &amp; c</p>", 240)).toBe("a b & c");
  });
});

describe("excerpt short input no ellipsis", () => {
  it("returns short input unchanged", () => {
    expect(excerptFrom("<p>یک جملهٔ کوتاه</p>", 240)).toBe("یک جملهٔ کوتاه");
    expect(excerptFrom("<p>یک جملهٔ کوتاه</p>", 240)).not.toMatch(/…$/);
  });

  it("whitespace-only input → empty string", () => {
    expect(excerptFrom("   \n  ")).toBe("");
    expect(excerptFrom("<p> </p>")).toBe("");
    expect(excerptFrom("")).toBe("");
  });
});
