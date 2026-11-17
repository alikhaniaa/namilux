import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FA,
  MAX_TOMAN,
  clean,
  cleanFold,
  cleanNumber,
  issuesToDetails,
  uniqueBy,
  zBool,
  zDigits,
  zEmail,
  zHex,
  zHref,
  zId,
  zInt,
  zIsoDate,
  zIsoDateTime,
  zLatinKey,
  zLatinSlug,
  zMultiline,
  zPath,
  zPhone,
  zSlug,
  zSort,
  zText,
  zTextFold,
  zTomanInput,
  zUlid,
} from "../common";

const NUL = "\x00";
const RLO = "\u202E"; // bidi override (05 T9)
const LRI = "\u2066";
const BOM = "﻿";

describe("clean / cleanFold / cleanNumber", () => {
  it("clean strips C0/C1 and bidi controls, then trims, and keeps newlines", () => {
    expect(clean("  سلام  ")).toBe("سلام");
    expect(clean(`a${NUL}b`)).toBe("ab");
    expect(clean(`${RLO}09121230077`)).toBe("09121230077");
    expect(clean(`a${LRI}b${BOM}c`)).toBe("abc");
    expect(clean("a\x7fb\x9fc")).toBe("abc");
    expect(clean("خط اول\nخط دوم")).toBe("خط اول\nخط دوم");
    expect(clean("\n line \n")).toBe("line");
    expect(clean("متن‌با نیم‌فاصله")).toBe("متن‌با نیم‌فاصله"); // ZWNJ survives
  });

  it("clean passes non-strings through untouched", () => {
    const obj = { a: 1 };
    expect(clean(obj)).toBe(obj);
    expect(clean(42)).toBe(42);
    expect(clean(null)).toBe(null);
    expect(clean(undefined)).toBe(undefined);
    expect(clean(true)).toBe(true);
  });

  it("cleanFold also folds Persian and Arabic digits", () => {
    expect(cleanFold(" ۱۲۳ عدد ")).toBe("123 عدد");
    expect(cleanFold("٤٥٦")).toBe("456"); // Arabic-Indic
    expect(cleanFold(`${RLO}۰۹۱۲`)).toBe("0912");
    expect(cleanFold(7)).toBe(7);
  });

  it("cleanNumber folds digits, drops ٬ , and spaces, and returns the string when it is not a number", () => {
    expect(cleanNumber("۴۱٬۵۰۰٬۰۰۰")).toBe(41500000);
    expect(cleanNumber("41,500,000")).toBe(41500000);
    expect(cleanNumber(" 1 000 ")).toBe(1000);
    expect(cleanNumber("-5")).toBe(-5);
    expect(cleanNumber("1.5")).toBe(1.5);
    expect(cleanNumber("")).toBe("");
    expect(cleanNumber("abc")).toBe("abc");
    expect(cleanNumber("12abc")).toBe("12abc");
    expect(cleanNumber("0x10")).toBe("0x10");
    expect(cleanNumber("1e3")).toBe("1e3");
    expect(cleanNumber("Infinity")).toBe("Infinity");
    expect(cleanNumber(12)).toBe(12);
    expect(cleanNumber(null)).toBe(null);
  });
});

describe("zText bounds", () => {
  it("trims, enforces min and max, and rejects non-strings", () => {
    expect(zText(10).parse("  سلام  ")).toBe("سلام");
    expect(() => zText(3).parse("چهار حرف")).toThrow();
    expect(() => zText(10, 2).parse("a")).toThrow();
    expect(zText(10, 2).parse("ab")).toBe("ab");
    expect(zText(4).parse("۱۲۳۴")).toBe("۱۲۳۴"); // zText does NOT fold
    expect(zTextFold(20).parse("۱۲۳ عدد")).toBe("123 عدد");
    expect(() => zText(10).parse(12)).toThrow();
    expect(() => zText(10).parse(null)).toThrow();
    expect(() => zText(10).parse(["a"])).toThrow();
    expect(() => zText(10).parse({})).toThrow();
  });

  it("counts the cleaned length, so control padding cannot smuggle extra characters", () => {
    expect(zText(3).parse(`ab${NUL}c`)).toBe("abc");
    expect(() => zText(3).parse("abcd")).toThrow();
    expect(() => zText(200).parse("x".repeat(201))).toThrow();
    expect(zText(200).parse("x".repeat(200)).length).toBe(200);
  });

  it("a min of 1 rejects a string that is only whitespace or only controls", () => {
    expect(() => zText(10, 1).parse("   ")).toThrow();
    expect(() => zText(10, 1).parse(NUL + RLO)).toThrow();
  });

  it("zMultiline keeps newlines", () => {
    expect(zMultiline(50).parse(" خط اول\nخط دوم ")).toBe("خط اول\nخط دوم");
    expect(() => zMultiline(5, 2).parse("a")).toThrow();
  });

  it("uses the Persian field messages", () => {
    const tooLong = zText(2).safeParse("abc");
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe(FA.tooLong);
    const tooShort = zText(10, 5).safeParse("abc");
    expect(tooShort.error?.issues[0]?.message).toBe(FA.tooShort);
    for (const message of Object.values(FA)) {
      expect(message).not.toMatch(/[0-9]/); // the spec - no Latin digits in copy
      expect(message).not.toMatch(/!/);
    }
  });
});

describe("zDigits", () => {
  it("folds and requires exactly the given length", () => {
    expect(zDigits(6).parse("۱۲۳۴۵۶")).toBe("123456");
    expect(zDigits(6).parse("123456")).toBe("123456");
    expect(zDigits(6).parse("٤٥٦٧٨٩")).toBe("456789");
    expect(zDigits(6).parse(" ۱۲۳۴۵۶ ")).toBe("123456");
    expect(() => zDigits(6).parse("12345")).toThrow();
    expect(() => zDigits(6).parse("1234567")).toThrow();
    expect(() => zDigits(6).parse("12345a")).toThrow();
    expect(() => zDigits(6).parse("12 34 56")).toThrow();
    expect(() => zDigits(6).parse("۱۲۳۴۵۶۰")).toThrow();
    expect(() => zDigits(6).parse(123456)).toThrow();
    expect(zDigits(10).parse("۱۳۹۱۶۵۴۳۲۱")).toBe("1391654321");
  });
});

describe("zTomanInput table", () => {
  const ok: [unknown, number][] = [
    [0, 0],
    [1000, 1000],
    ["۴۱٬۵۰۰٬۰۰۰", 41500000],
    ["41,500,000", 41500000],
    ["0", 0],
    [MAX_TOMAN, MAX_TOMAN],
  ];
  const bad: unknown[] = [-1, 1.5, "abc", "", "1.5", MAX_TOMAN + 1, null, undefined, true, [], {}, NaN, Infinity, "-1"];

  it("accepts folded integer Toman and rejects everything else", () => {
    for (const [input, expected] of ok) {
      expect(zTomanInput.parse(input), JSON.stringify(input)).toBe(expected);
    }
    for (const input of bad) {
      expect(() => zTomanInput.parse(input), JSON.stringify(input)).toThrow();
    }
  });

  it("zInt enforces its own range and folds digits", () => {
    expect(zInt(1, 5).parse("۴")).toBe(4);
    expect(zInt(1, 5).parse(5)).toBe(5);
    expect(() => zInt(1, 5).parse(0)).toThrow();
    expect(() => zInt(1, 5).parse(6)).toThrow();
    expect(() => zInt(1, 5).parse(4.5)).toThrow();
    expect(zInt(-10, 10).parse("-10")).toBe(-10);
  });

  it("zId is a positive serial id, zSort defaults to 0, zBool is strict", () => {
    expect(zId.parse("۱۰۴۴")).toBe(1044);
    expect(zId.parse(1)).toBe(1);
    expect(zId.parse(2_147_483_647)).toBe(2_147_483_647);
    expect(() => zId.parse(0)).toThrow();
    expect(() => zId.parse(-1)).toThrow();
    expect(() => zId.parse(2_147_483_648)).toThrow();
    expect(() => zId.parse("1e3")).toThrow();

    expect(zSort.parse(undefined)).toBe(0);
    expect(zSort.parse("۱۰")).toBe(10);
    expect(() => zSort.parse(100_001)).toThrow();

    expect(zBool.parse(true)).toBe(true);
    expect(() => zBool.parse("true")).toThrow();
    expect(() => zBool.parse(1)).toThrow();
  });

  it("zUlid accepts the canonical form only", () => {
    expect(zUlid.parse("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(() => zUlid.parse("01arz3ndektsv4rrffq69g5fav")).toThrow();
    expect(() => zUlid.parse("01ARZ3NDEKTSV4RRFFQ69G5FA")).toThrow();
    expect(() => zUlid.parse(" 01ARZ3NDEKTSV4RRFFQ69G5FAV")).toThrow();
    expect(() => zUlid.parse("01ARZ3NDEKTSV4RRFFQ69G5FAU")).toThrow();
    expect(() => zUlid.parse(1)).toThrow();
  });
});

describe("zSlug / zLatinSlug / zLatinKey", () => {
  it("zSlug takes a decoded slug and refuses separators, escapes and traversal", () => {
    expect(zSlug.parse("کتری-برقی")).toBe("کتری-برقی");
    expect(zSlug.parse(" چای‌ساز ")).toBe("چای‌ساز");
    expect(zSlug.parse("kettle-04")).toBe("kettle-04");
    for (const bad of ["a/b", "%d8", "a b", "..", "a..b", "../etc", "a?b", "a#b", "a\\b", "", "x".repeat(201)]) {
      expect(() => zSlug.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("zLatinSlug is lowercase kebab only", () => {
    expect(zLatinSlug.parse("smeg")).toBe("smeg");
    expect(zLatinSlug.parse("de-longhi")).toBe("de-longhi");
    for (const bad of ["Smeg", "de--longhi", "-smeg", "smeg-", "smeg_01", "چای", "", "a".repeat(81)]) {
      expect(() => zLatinSlug.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("zLatinKey is a snake_case identifier of at most 32 chars", () => {
    expect(zLatinKey.parse("shipping_faq")).toBe("shipping_faq");
    expect(zLatinKey.parse("a")).toBe("a");
    for (const bad of ["Color", "1color", "_color", "color-1", "color.1", "", "a".repeat(33)]) {
      expect(() => zLatinKey.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(zLatinKey.parse(`a${"b".repeat(31)}`).length).toBe(32);
  });
});

describe("zPath / zHref reject unsafe forms", () => {
  it("zPath is an absolute site path with a trailing slash", () => {
    expect(zPath.parse("/shop/")).toBe("/shop/");
    expect(zPath.parse("/")).toBe("/");
    expect(zPath.parse(" /shop/kettle/ ")).toBe("/shop/kettle/");
    for (const bad of [
      "/shop",
      "/a/../b/",
      "//evil/",
      "shop/",
      "",
      "/a b/",
      "/a\tb/",
      "https://namilux.ir/shop/",
      "http://x/",
      "javascript:alert(1)",
      "//",
      `/${"a".repeat(512)}/`,
    ]) {
      expect(() => zPath.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("zHref accepts a site-relative href or an https url and nothing else", () => {
    expect(zHref.parse("https://namilux.ir/shop/")).toBe("https://namilux.ir/shop/");
    expect(zHref.parse("/shop/?page=2")).toBe("/shop/?page=2");
    expect(zHref.parse("/")).toBe("/");
    for (const bad of [
      "http://x/",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.com/",
      "vbscript:msgbox(1)",
      "https://",
      "shop/",
      "",
      "/a/../b/",
      "/a b/",
      `https://namilux.ir/${"a".repeat(512)}`,
    ]) {
      expect(() => zHref.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("zEmail lowercases", () => {
  it("trims, lowercases and validates", () => {
    expect(zEmail.parse(" A@B.IR ")).toBe("a@b.ir");
    expect(zEmail.parse("Owner@Namilux.IR")).toBe("owner@namilux.ir");
    for (const bad of ["a@b", "a b@c.ir", "@b.ir", "a@", "", "a@b..ir", `${"a".repeat(250)}@b.ir`, 5, null]) {
      expect(() => zEmail.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("zPhone normalizes", () => {
  it("accepts every shape an Iranian actually types", () => {
    const shapes = [
      "09121230077",
      "0912 123 0077",
      "0912-123-0077",
      "(0912)1230077",
      "0912.123.0077",
      "+989121230077",
      "+98 912 123 0077",
      "989121230077",
      "00989121230077",
      "9121230077",
      "۰۹۱۲۱۲۳۰۰۷۷",
      "۰۹۱۲ ۱۲۳ ۰۰۷۷",
      "+۹۸۹۱۲۱۲۳۰۰۷۷",
      "٠٩١٢١٧٥٤٩٧٧",
      ` ${RLO}09121230077 `,
    ];
    for (const shape of shapes) {
      expect(zPhone.parse(shape), JSON.stringify(shape)).toBe("09121230077");
    }
    expect(zPhone.parse("09901230077")).toBe("09901230077");
  });

  it("rejects landlines, wrong lengths and junk with the phone message", () => {
    for (const bad of [
      "02155550000",
      "0912123007",
      "091212300777",
      "08121230077",
      "09451230077",
      "+19121230077",
      "0912123007a",
      "",
      "         ",
      5,
      null,
      undefined,
    ]) {
      expect(() => zPhone.parse(bad), JSON.stringify(bad)).toThrow();
    }
    const r = zPhone.safeParse("02155550000");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(FA.phone);
  });
});

describe("zHex", () => {
  it("is lowercase hex of exactly bytes*2 characters", () => {
    expect(zHex(32).parse("ab".repeat(32))).toBe("ab".repeat(32));
    for (const bad of ["AB".repeat(32), "ab".repeat(31), "ab".repeat(33), `${"ab".repeat(31)}gg`, "", 1]) {
      expect(() => zHex(32).parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(zHex(16).parse("0".repeat(32))).toBe("0".repeat(32));
    expect(() => zHex(16).parse(" " + "0".repeat(32))).toThrow();
  });
});

describe("dates", () => {
  it("zIsoDate is a Gregorian YYYY-MM-DD and zIsoDateTime needs an offset", () => {
    expect(zIsoDate.parse("2026-08-25")).toBe("2026-08-25");
    for (const bad of ["2026-8-25", "1405-06-03T00:00:00Z", "25-08-2026", "2026-13-01", ""]) {
      expect(() => zIsoDate.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(zIsoDateTime.parse("2026-08-25T10:00:00.000Z")).toBe("2026-08-25T10:00:00.000Z");
    expect(zIsoDateTime.parse("2026-08-25T10:00:00+03:30")).toBe("2026-08-25T10:00:00+03:30");
    for (const bad of ["2026-08-25T10:00:00", "2026-08-25", "now"]) {
      expect(() => zIsoDateTime.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("uniqueBy / issuesToDetails", () => {
  it("uniqueBy detects a repeated key", () => {
    expect(uniqueBy([{ id: 1 }, { id: 2 }], (x) => x.id)).toBe(true);
    expect(uniqueBy([{ id: 1 }, { id: 1 }], (x) => x.id)).toBe(false);
    expect(uniqueBy([], (x) => x)).toBe(true);
    expect(uniqueBy([1, "1"], (x) => x)).toBe(true); // Set is type-aware
    expect(uniqueBy(["a", "a"], (x) => x)).toBe(false);
  });

  it("issuesToDetails maps path ['lines', 0, 'qty'] to 'lines.0.qty'", () => {
    const schema = z.object({ lines: z.array(z.object({ qty: zInt(1, 99) })) });
    const r = schema.safeParse({ lines: [{ qty: 0 }] });
    expect(r.success).toBe(false);
    const details = issuesToDetails(r.error!);
    expect(details).toEqual([{ path: "lines.0.qty", message: FA.invalid }]);

    const root = zText(2).safeParse("abc");
    expect(issuesToDetails(root.error!)).toEqual([{ path: "", message: FA.tooLong }]);
    expect(issuesToDetails(new z.ZodError([]))).toEqual([]);
  });
});
