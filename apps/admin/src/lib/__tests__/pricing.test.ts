import { describe, expect, it } from "vitest";
import { exportPriceList, indexProducts, matchLine, parsePriceList } from "../price-paste";
import {
  changedOn,
  describeChange,
  digitsToToman,
  foldCode,
  groupDigits,
  jumpLabel,
  lastChangedLabel,
  matchesTokens,
  priceDigits,
  queryTokens,
  searchHaystack,
  sourceLabel,
  tehranDayStart,
} from "../pricing";
import type { PriceRow } from "../pricing";

let seq = 0;
function product(over: Partial<PriceRow>): PriceRow {
  seq += 1;
  return {
    id: seq,
    name: "کالا",
    displayName: "کالا",
    sku: null,
    modelCode: null,
    colorName: null,
    brandId: 1,
    brandName: "اسمگ",
    price: 10_000_000,
    compareAtPrice: null,
    priceBasis: "manual",
    status: "active",
    priceUpdatedAt: null,
    available: true,
    imageKey: null,
    categoryIds: [],
    ...over,
  };
}

describe("an amount as it is typed", () => {
  it("reads Persian, Arabic and Latin digits and whatever separators came with them", () => {
    expect(priceDigits("۱۲٬۵۰۰٬۰۰۰ تومان")).toBe("12500000");
    expect(priceDigits("12,500,000")).toBe("12500000");
    expect(priceDigits("١٢٥٠٠٠٠٠")).toBe("12500000");
    expect(priceDigits("0012")).toBe("12");
    expect(priceDigits("0")).toBe("0");
    expect(priceDigits("abc")).toBe("");
  });

  it("never holds more digits than the core can store", () => {
    const digits = priceDigits("9".repeat(30));
    expect(digits).toHaveLength(13);
    expect(digitsToToman(digits)).toBe(9_999_999_999_999);
  });

  it("groups in threes from the right, in Persian digits", () => {
    expect(groupDigits("12500000")).toBe("۱۲٬۵۰۰٬۰۰۰");
    expect(groupDigits("999")).toBe("۹۹۹");
    expect(groupDigits("1000")).toBe("۱٬۰۰۰");
    expect(groupDigits("")).toBe("");
  });

  it("turns digits into Toman, and an empty box into nothing", () => {
    expect(digitsToToman("12500000")).toBe(12_500_000);
    expect(digitsToToman("0")).toBe(0);
    expect(digitsToToman("")).toBeNull();
  });
});

describe("finding a product", () => {
  const row = product({ displayName: "اسمگ آب مرکبات‌گیری CJF01 · مشکی", sku: "SMG-CJF01-BL", modelCode: "CJF01", colorName: "مشکی" });

  it("matches every typed word wherever it sits, whichever yeh, kaf and digits were typed", () => {
    const hay = searchHaystack(row);
    expect(matchesTokens(hay, queryTokens("cjf01 مشكي"))).toBe(true);
    expect(matchesTokens(hay, queryTokens("مرکبات گیری اسمگ"))).toBe(true);
    expect(matchesTokens(hay, queryTokens(`#${String(row.id)}`))).toBe(true);
    expect(matchesTokens(hay, queryTokens("cjf01 قرمز"))).toBe(false);
    expect(queryTokens("   ")).toEqual([]);
  });

  it("treats a code's punctuation as noise", () => {
    expect(foldCode("ECAM 22.110")).toBe(foldCode("ecam22110"));
    expect(foldCode("KM-5330")).toBe("km5330");
  });
});

describe("a change in words", () => {
  it("names the direction, the amount and the per cent", () => {
    expect(describeChange(1_000_000, 1_050_000)).toEqual({ direction: "up", text: "+۵۰٬۰۰۰ · ۵٪" });
    expect(describeChange(1_000_000, 900_000)).toEqual({ direction: "down", text: "−۱۰۰٬۰۰۰ · ۱۰٪" });
    expect(describeChange(1_000_000, 1_000_000).direction).toBe("same");
    expect(describeChange(0, 1_000_000).direction).toBe("new");
    expect(describeChange(1_000_000, 0).direction).toBe("removed");
  });

  it("says how big a jump is, in either direction", () => {
    expect(jumpLabel(12_500_000, 125_000_000)).toBe("۱۰ برابر قیمت فعلی");
    expect(jumpLabel(12_500_000, 1_250_000)).toBe("۱۰ برابر کمتر از قیمت فعلی");
    expect(jumpLabel(10_000_000, 35_000_000)).toBe("۳٫۵ برابر قیمت فعلی");
  });

  it("names where a logged change came from", () => {
    expect(sourceLabel("price-sheet", "staff")).toBe("تغییر سریع");
    expect(sourceLabel("bulk:percent", "staff")).toBe("تغییر گروهی");
    expect(sourceLabel("fx EUR 98000", "staff")).toBe("نرخ ارز");
    expect(sourceLabel(null, "staff")).toBe("صفحهٔ محصول");
    expect(sourceLabel(null, "system")).toBe("سیستم");
    expect(sourceLabel("تغییر گروهی · ۵٪ افزایش", "staff")).toBe("تغییر گروهی · ۵٪ افزایش");
  });
});

describe("the shop's day", () => {
  const NOW = Date.parse("2026-10-01T06:00:00Z"); // 09:30 in Tehran

  it("starts at Tehran's midnight, not UTC's", () => {
    expect(tehranDayStart(NOW).toISOString()).toBe("2026-09-30T20:30:00.000Z");
    expect(tehranDayStart(NOW, 6).toISOString()).toBe("2026-09-24T20:30:00.000Z");
    // 21:00 UTC is already tomorrow in Tehran
    expect(tehranDayStart(Date.parse("2026-10-01T21:00:00Z")).toISOString()).toBe("2026-10-01T20:30:00.000Z");
  });

  it("says when a price last moved the way a daily repricer thinks of it", () => {
    expect(lastChangedLabel("2026-10-01T05:36:00Z", NOW)).toBe("امروز ۰۹:۰۶");
    expect(lastChangedLabel("2026-09-30T10:00:00Z", NOW)).toBe("دیروز");
    expect(lastChangedLabel("2026-09-28T10:00:00Z", NOW)).toBe("۲ روز پیش");
    expect(lastChangedLabel(null, NOW)).toBe("ثبت نشده");
    expect(changedOn("2026-10-01T05:36:00Z", "2026-10-01")).toBe(true);
    expect(changedOn("2026-09-30T20:00:00Z", "2026-10-01")).toBe(false);
    expect(changedOn(null, "2026-10-01")).toBe(false);
  });
});

describe("a pasted price list", () => {
  it("takes the last number on a line as the price and the rest as the product", () => {
    const lines = parsePriceList("KM-5330    12,500,000\nاسپرسوساز دلونگی ECAM 22.110    ۴۵٬۰۰۰٬۰۰۰\nKM 5330 12 500 000\nCJF01G: 37500000 تومان");
    expect(lines.map((l) => [l.key, l.price])).toEqual([
      ["KM-5330", 12_500_000],
      ["اسپرسوساز دلونگی ECAM 22.110", 45_000_000],
      ["KM 5330", 12_500_000],
      ["CJF01G", 37_500_000],
    ]);
  });

  it("reads spreadsheet rows by cell, and never lets an empty price cell promote the code beside it", () => {
    const lines = parsePriceList("کد پنل\tنام کالا\tکد کالا\tقیمت (تومان)\n#12\tیخچال\t5330\t98000000\n#13\tاجاق\t5331\t\nKM-1\t۱۲٬۰۰۰٬۰۰۰\tتوضیح");
    expect(lines.map((l) => [l.id, l.key, l.price])).toEqual([
      [null, "کد پنل نام کالا کد کالا قیمت (تومان)", null],
      [12, "یخچال 5330", 98_000_000],
      [13, "اجاق 5331", null],
      [null, "KM-1", 12_000_000],
    ]);
  });

  it("converts a list written in Rial, and skips blank lines while keeping line numbers", () => {
    const lines = parsePriceList("KM-1 125000000\n\n\nKM-2 5000", "rial");
    expect(lines.map((l) => [l.line, l.price])).toEqual([[1, 12_500_000], [4, 500]]);
  });

  it("leaves a line with no amount, or a number that is no amount, without a price", () => {
    expect(parsePriceList("فهرست امروز")[0]?.price).toBeNull();
    expect(parsePriceList("KM-1 12,50")[0]?.price).toBeNull();
    // a hyphen inside a code is not what separates a product from its price
    expect(parsePriceList("KM-5330")[0]).toMatchObject({ key: "KM-5330", price: null });
    expect(parsePriceList("12500000")[0]).toMatchObject({ key: "", price: 12_500_000 });
  });
});

describe("matching a line to a product", () => {
  const black = product({ displayName: "اسمگ آسیاب قهوه CGF01 · مشکی", modelCode: "CGF01", colorName: "مشکی" });
  const white = product({ displayName: "اسمگ آسیاب قهوه CGF01 · سفید", modelCode: "CGF01", colorName: "سفید" });
  const juicer = product({ displayName: "اسمگ آب مرکبات‌گیری CJF01W · سفید", sku: "CJF-01-W", modelCode: "CJF01W", colorName: "سفید" });
  const index = indexProducts([black, white, juicer]);
  const match = (text: string) => matchLine(parsePriceList(text)[0] ?? { key: "", id: null }, index);

  it("trusts the panel's own id above everything on the line", () => {
    expect(match(`#${String(white.id)} هر چیزی 1000`)).toEqual({ kind: "one", row: white });
    expect(match("#9999999 1000")).toEqual({ kind: "none" });
  });

  it("finds a product by its code however the code was punctuated", () => {
    expect(match("cjf01w 38000000")).toEqual({ kind: "one", row: juicer });
    expect(match("CJF 01 W 38000000")).toEqual({ kind: "one", row: juicer });
  });

  it("asks which one when a model has several colours, and lets the colour on the line decide", () => {
    expect(match("CGF01 33000000")).toEqual({ kind: "many", rows: [black, white] });
    expect(match("آسیاب CGF01 سفید 33000000")).toEqual({ kind: "one", row: white });
  });

  it("falls back to the words of the name, and admits when nothing fits", () => {
    expect(match("آب مرکبات گیری سفید 38000000")).toEqual({ kind: "one", row: juicer });
    expect(match("XYZ-000 5000000")).toEqual({ kind: "none" });
  });

  it("exports a sheet that reads back as the same products and prices", () => {
    const back = parsePriceList(exportPriceList([black, juicer]));
    expect(back[0]?.price).toBeNull();
    expect(back.slice(1).map((l) => [matchLine(l, index), l.price])).toEqual([
      [{ kind: "one", row: black }, black.price],
      [{ kind: "one", row: juicer }, juicer.price],
    ]);
  });
});
