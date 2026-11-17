import { describe, expect, it } from "vitest";

import {
  enDigits,
  faDigits,
  faInt,
  formatDeliveryRange,
  formatJalali,
  formatRelative,
  formatToman,
  splitLatinRuns,
  truncateWords,
} from "../format";

const SEP = "٬"; // ٬ thousands separator
const MINUS = "−"; // − true minus
const DOTS = "…"; // … ellipsis
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe("persian/format", () => {
  it("faInt table", () => {
    const table: [number, string][] = [
      [0, "۰"],
      [7, "۷"],
      [999, "۹۹۹"],
      [1000, `۱${SEP}۰۰۰`],
      [1234567, `۱${SEP}۲۳۴${SEP}۵۶۷`],
      [41500000, `۴۱${SEP}۵۰۰${SEP}۰۰۰`],
      [242000000, `۲۴۲${SEP}۰۰۰${SEP}۰۰۰`],
      [-1500, `${MINUS}۱${SEP}۵۰۰`],
      [12.9, "۱۲"],
      [-0.5, "۰"],
    ];
    for (const [input, expected] of table) expect(faInt(input)).toBe(expected);
    for (const [input] of table) expect(faInt(input)).not.toMatch(/[0-9]/);
    expect(() => faInt(Number.NaN)).toThrow(RangeError);
    expect(() => faInt(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => faInt(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
    expect(formatToman(41500000)).toBe(faInt(41500000));
  });

  it("faDigits guard table", () => {
    const table: [string | number, boolean, string][] = [
      ["12 عدد", false, "۱۲ عدد"],
      ["KLF04", false, "KLF۰۴"],
      ["KLF04", true, "KLF04"],
      ["HS08 · 08", true, "HS08 · ۰۸"],
      ["V16s", true, "V16s"],
      ["V16s", false, "V۱۶s"],
      [1500, false, "۱۵۰۰"],
      ["٣", false, "۳"],
      ["٠٩١٢", true, "۰۹۱۲"],
      ["", false, ""],
      ["۱۲", true, "۱۲"],
    ];
    for (const [input, guard, expected] of table) expect(faDigits(input, guard)).toBe(expected);
    // guard defaults to false
    expect(faDigits("KLF04")).toBe("KLF۰۴");
  });

  it("enDigits table", () => {
    const table: [string, string][] = [
      ["۰۹۱۲۱۲۳۰۰۷۷", "09121230077"],
      ["٠٩١٢", "0912"],
      ["abc", "abc"],
      ["", ""],
      ["۱٫۷ لیتر", "1٫7 لیتر"],
      ["KLF۰۴", "KLF04"],
    ];
    for (const [input, expected] of table) expect(enDigits(input)).toBe(expected);
  });

  it("formatJalali styles and Tehran zone", () => {
    const iso = "2026-08-20T12:00:00.000Z";
    expect(formatJalali(iso)).toBe("۲۹ مرداد ۱۴۰۵");
    expect(formatJalali(iso, "long")).toBe("۲۹ مرداد ۱۴۰۵");
    expect(formatJalali(iso, "short")).toBe("۲۹ مرداد");
    expect(formatJalali(iso, "numeric")).toBe("۱۴۰۵/۰۵/۲۹");
    // 21 Mar 03:00 in Tehran - the zone decides the Jalali day
    expect(formatJalali("2026-03-20T23:30:00.000Z")).toBe("۱ فروردین ۱۴۰۵");
    expect(formatJalali("nope")).toBe("");
    expect(formatJalali("")).toBe("");
  });

  it("formatDeliveryRange walks working days in the Tehran zone", () => {
    const monday = new Date("2026-08-10T08:00:00.000Z"); // ۱۹ مرداد
    expect(formatDeliveryRange(1, 3, monday)).toBe("۲۰ تا ۲۲ مرداد");
    const thursday = new Date("2026-08-20T08:00:00.000Z"); // ۲۹ مرداد - Friday is skipped
    expect(formatDeliveryRange(1, 3, thursday)).toBe("۳۱ مرداد تا ۲ شهریور");
    expect(formatDeliveryRange(2, 2, thursday)).toBe("۱ شهریور");
    expect(formatDeliveryRange(0, 0, thursday)).toBe("۲۹ مرداد");
    expect(formatDeliveryRange(3, 1, monday)).toBe("۲۰ تا ۲۲ مرداد"); // order-insensitive
    expect(formatDeliveryRange(Number.NaN, 2, monday)).toBe("");
    expect(formatDeliveryRange(-1, 2, monday)).toBe("");
    expect(formatDeliveryRange(1, 2, new Date("nope"))).toBe("");
  });

  it("formatRelative buckets", () => {
    const at = (ms: number): string => new Date(NOW - ms).toISOString();
    const table: [string, string][] = [
      [at(30_000), "همین حالا"],
      [at(5 * MINUTE), "۵ دقیقه پیش"],
      [at(3 * HOUR), "۳ ساعت پیش"],
      [at(2 * DAY), "۲ روز پیش"],
      [at(10 * DAY), "۱ هفته پیش"],
      [at(-2 * DAY), "۲ روز دیگر"],
      [at(-30_000), "همین حالا"],
      [at(-45 * MINUTE), "۴۵ دقیقه دیگر"],
    ];
    for (const [iso, expected] of table) expect(formatRelative(iso, NOW)).toBe(expected);
    // beyond a month it falls back to the long Jalali date
    const old = new Date(NOW - 45 * DAY).toISOString();
    expect(formatRelative(old, NOW)).toBe(formatJalali(old, "long"));
    expect(formatRelative("nope", NOW)).toBe("");
  });

  it("truncateWords table", () => {
    const table: [string, number, string][] = [
      ["یک دو سه چهار", 2, `یک دو${DOTS}`],
      ["یک دو", 5, "یک دو"],
      ["یک دو، سه", 2, `یک دو${DOTS}`],
      ["", 3, ""],
      ["یک دو سه", 0, DOTS],
      // "words ≤ max → the trimmed input unchanged": inner whitespace is not touched
      ["  یک   دو  ", 5, "یک   دو"],
      ["یک دو سه.", 3, "یک دو سه."],
      ["Dyson V15 Detect جارو", 2, `Dyson V15${DOTS}`],
    ];
    for (const [input, max, expected] of table) expect(truncateWords(input, max)).toBe(expected);
  });

  it("splitLatinRuns table", () => {
    expect(splitLatinRuns("دایسون ایرپ‌استایلر HS08 · رد ولوت")).toEqual([
      { text: "دایسون ایرپ‌استایلر ", latin: false },
      { text: "HS08", latin: true },
      { text: " · رد ولوت", latin: false },
    ]);
    expect(splitLatinRuns("Dyson V15 Detect جارو")).toEqual([
      { text: "Dyson V15 Detect", latin: true },
      { text: " جارو", latin: false },
    ]);
    expect(splitLatinRuns("کتری ۱٫۷ لیتری")).toEqual([{ text: "کتری ۱٫۷ لیتری", latin: false }]);
    expect(splitLatinRuns("")).toEqual([]);
    expect(splitLatinRuns("Smeg")).toEqual([{ text: "Smeg", latin: true }]);
    // concatenating every run reproduces the input exactly
    for (const s of [
      "دایسون ایرپ‌استایلر HS08 · رد ولوت",
      "Dyson V15 Detect جارو",
      " کتری KLF04 برقی ",
      "کتری ۱٫۷ لیتری",
      "Smeg",
    ]) {
      expect(
        splitLatinRuns(s)
          .map((r) => r.text)
          .join(""),
      ).toBe(s);
    }
  });
});
