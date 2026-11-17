import { describe, expect, it } from "vitest";

import {
  collapseSpaces,
  faNorm,
  normalizeArabicLetters,
  normalizeForSlugMatch,
  stripControl,
  stripDiacritics,
} from "../normalize";

const ZWNJ = "‌";
const ZWJ = "‍";
const LRM = "\u200E";
const RLM = "\u200F";
const SOFT_HYPHEN = "\xad";
const TATWEEL = "ـ";
const RLO = "\u202E";
const BOM = "﻿";
const NBSP = " ";

/** 20 real names from data/extract/04_catalog/products_index.json. */
const SAMPLE_NAMES = [
  "ایرپ کواندا نیوکالکشن رنگ جسپر dyson hs09 jasper new",
  "حوله تن پوش‌نخی و رومایویی نخی کلاه‌دار موآی G5",
  "اسپرسو نیوکالشن اسمگ رنگ مشکی ecf03",
  "کتری برقی سفید طرح پورشه اسمگ",
  "سودا ساز سیج sca800bss",
  "جارو رباتیک اکووکس ecovacs x8 pro omi black",
  "قابلمه نچسب سرامیکی برگهف (BergHOFF) سری Balance سایز ۲۰ سانت (۳.۱ لیتر) مدل 3950428",
  "ست قاشق و چنگال ۳۰ نفره برگهف مدل Heritage | BergHOFF کد 1230502",
  "گریل چندکاره و سرخ‌کن بدون روغن نینجا AG651",
  "تصفیه هوا دایسون مرطوب کننده و خنک کننده سفید-طلایی مدل PH04",
  "اسپرسوساز صنعتی اسمگ مدل EMC02 سفید Smeg",
  "گریل سیج SAGE مدل SGR700BSS",
  "بخارشوی سطوح نرم بیسل BISSELL مدل Revolution Hydrosteam کد 3672E",
  "کتری رو گازی اسمگ صورتی CKLW2001PK Smeg",
  "مخلوط کن با 4 برنامه تک لمسی سیج SBL820SHY",
  "یخچال فاب 10 اسمگ SMEG مدل فریزر دار طرح انگلیس",
  "فوم ساز سفید اسمگ SMEG مدل MFF01",
  "آسیاب قهوه قرمز اسمگ SMEG مدل CGF02",
  "ایرپ دایسون بنفش  Dyson Airwrap Prussian Blue HS08",
  "توستر 2 اسلایس بزرگ اسمگ SMEG مدل TSF02 سفید براق",
];

describe("persian/normalize", () => {
  it("faNorm table", () => {
    const table: [string, string][] = [
      ["كتري برقي", "کتری برقی"],
      [`ویژگی${ZWNJ}ها`, "ویژگی ها"],
      [`ویژگی${ZWJ}ها`, "ویژگی ها"],
      ["KLF۰۴  Smeg", "klf04 smeg"],
      ["مَدرسة", "مدرسه"],
      ["  ", ""],
      ["", ""],
      [`سـ__TATWEEL__لام`.replace("__TATWEEL__", TATWEEL), "سلام"],
      ["مجموعۀ کتری", "مجموعه کتری"],
      ["٠٩١٢", "0912"],
      [`علی${LRM}`, "علی"],
      [`تهران${RLM}${SOFT_HYPHEN}`, "تهران"],
      ["\tجارو\nبرقی ", "جارو برقی"],
      [`قیمت${NBSP}ویژه`, "قیمت ویژه"],
      ["ىك", "یک"],
    ];
    for (const [input, expected] of table) expect(faNorm(input)).toBe(expected);
    expect(faNorm(undefined as never)).toBe("");
    expect(faNorm(null as never)).toBe("");
  });

  it("faNorm matches the SQL twin nl_fa_norm on the shared table", () => {
    // captured from `psql -c "select nl_fa_norm(…)"` on PostgreSQL 16.10 with 0000_extensions.sql
    const shared: [string, string][] = [
      ["كتري برقي", "کتری برقی"],
      ["KLF۰۴  Smeg", "klf04 smeg"],
      ["مَدرسه", "مدرسه"],
      ["  ", ""],
      ["", ""],
      ["٠٩١٢", "0912"],
      ["Smeg KLF04", "smeg klf04"],
      ["سُفره", "سفره"],
      [`علی${LRM}`, "علی"],
      [`تهران${SOFT_HYPHEN}`, "تهران"],
      ["کتری ۱۲۳ برقی", "کتری 123 برقی"],
      ["\tجارو\nبرقی ", "جارو برقی"],
      ["ىك", "یک"],
      ["ABC   def", "abc def"],
      ["موردِ توجّه", "مورد توجه"],
    ];
    for (const [input, expected] of shared) expect(faNorm(input)).toBe(expected);
  });

  it("faNorm idempotent", () => {
    for (const name of SAMPLE_NAMES) {
      const once = faNorm(name);
      expect(faNorm(once)).toBe(once);
      expect(once).not.toMatch(/[۰-۹٠-٩]/);
      expect(once).not.toMatch(/[كيىۀة]/);
    }
    for (const input of ["كتري برقي", `ویژگی${ZWNJ}ها`, "  ", "مَدرسة"]) {
      expect(faNorm(faNorm(input))).toBe(faNorm(input));
    }
  });

  it("stripControl removes bidi and C0 but keeps ZWNJ", () => {
    expect(stripControl(`ali${RLO}reza`)).toBe("alireza");
    expect(stripControl("a\x00b")).toBe("ab");
    expect(stripControl("a\x1fb")).toBe("ab");
    expect(stripControl("a\x7fb")).toBe("ab");
    expect(stripControl("a\x9bb")).toBe("ab");
    expect(stripControl(`a${BOM}b`)).toBe("ab");
    expect(stripControl("a\u2066b\u2069c")).toBe("abc");
    expect(stripControl("a\tb\nc")).toBe("a\tb\nc");
    expect(stripControl("a\r\nb")).toBe("a\r\nb");
    expect(stripControl(`نیم${ZWNJ}فاصله`)).toBe(`نیم${ZWNJ}فاصله`);
    expect(stripControl(`الف${ZWJ}ب`)).toBe(`الف${ZWJ}ب`);
    expect(stripControl("")).toBe("");
  });

  it("collapseSpaces", () => {
    expect(collapseSpaces(" a   b ")).toBe("a b");
    expect(collapseSpaces(`a${NBSP}b`)).toBe("a b");
    expect(collapseSpaces("a\t\n b")).toBe("a b");
    expect(collapseSpaces("   ")).toBe("");
    expect(collapseSpaces("")).toBe("");
  });

  it("normalizeForSlugMatch", () => {
    expect(normalizeForSlugMatch("توستر-اسمگ")).toBe("توستر اسمگ");
    expect(normalizeForSlugMatch("smeg_toaster-TSF02")).toBe("smeg toaster tsf02");
    expect(normalizeForSlugMatch("-كتري--برقي-")).toBe("کتری برقی");
    expect(normalizeForSlugMatch("")).toBe("");
  });

  it("normalizeArabicLetters and stripDiacritics in isolation", () => {
    expect(normalizeArabicLetters("كتري")).toBe("کتری");
    expect(normalizeArabicLetters("مجموعۀ مدرسة")).toBe("مجموعه مدرسه");
    // ؤ is a distinct word form and must survive
    expect(normalizeArabicLetters("مؤسسه")).toBe("مؤسسه");
    expect(stripDiacritics("مَدرسه")).toBe("مدرسه");
    expect(stripDiacritics(`سـلام`.replace("ـ", TATWEEL))).toBe("سلام");
    expect(stripDiacritics("کتری")).toBe("کتری");
  });
});
