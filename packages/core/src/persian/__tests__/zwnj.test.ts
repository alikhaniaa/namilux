import { describe, expect, it } from "vitest";

import { COMPOUNDS, faZwnj, hasMissingZwnj, ZWNJ } from "../zwnj";

const Z = "‌";

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

describe("persian/zwnj", () => {
  it("suffix table", () => {
    const table: [string, string][] = [
      ["ویژگی ها", `ویژگی${Z}ها`],
      ["کتری های برقی", `کتری${Z}های برقی`],
      ["دستگاه هایی که", `دستگاه${Z}هایی که`],
      ["بزرگ تر", `بزرگ${Z}تر`],
      ["بزرگ ترین", `بزرگ${Z}ترین`],
      ["خانه ام", `خانه${Z}ام`],
      ["کتاب ات", `کتاب${Z}ات`],
      ["کتاب اش", `کتاب${Z}اش`],
      ["خانه مان", `خانه${Z}مان`],
      ["خانه تان", `خانه${Z}تان`],
      ["خانه شان", `خانه${Z}شان`],
      ["ویژگی ها.", `ویژگی${Z}ها.`],
      ["دستگاه ها  و", `دستگاه${Z}ها  و`],
      ["بهترین", "بهترین"],
      ["ها", "ها"],
      ["تر بزرگ", "تر بزرگ"],
      ["۱۲ تا", "۱۲ تا"],
    ];
    for (const [input, expected] of table) expect(faZwnj(input)).toBe(expected);
  });

  it("prefix table", () => {
    const table: [string, string][] = [
      ["می شود", `می${Z}شود`],
      ["نمی توان", `نمی${Z}توان`],
      ["بی نظیر", `بی${Z}نظیر`],
      ["این می شود", `این می${Z}شود`],
      ["«می شود»", `«می${Z}شود»`],
      ["نامی شود", "نامی شود"],
      ["می 12", "می 12"],
    ];
    for (const [input, expected] of table) expect(faZwnj(input)).toBe(expected);
  });

  it("compound table", () => {
    const table: [string, string][] = [
      ["سرخ کن های تفال", `سرخ${Z}کن${Z}های تفال`],
      ["قهوه ساز اسمگ ECF01", `قهوه${Z}ساز اسمگ ECF01`],
      ["مخلوط کن سیج", `مخلوط${Z}کن سیج`],
      ["جارو برقی", "جاروبرقی"],
      ["آب میوه گیر", `آب${Z}میوه${Z}گیر`],
      ["نیم فاصله", `نیم${Z}فاصله`],
      ["نامی لوکس", `نامی${Z}لوکس`],
      ["ماشین ظرفشویی", "ماشین ظرفشویی"],
      ["دستگاه بخور", "دستگاه بخور"],
    ];
    for (const [input, expected] of table) expect(faZwnj(input)).toBe(expected);
    // the constant table itself is well-formed: no duplicate spaced form, no ZWNJ on the left
    const spacedForms = COMPOUNDS.map(([spaced]) => spaced);
    expect(new Set(spacedForms).size).toBe(spacedForms.length);
    for (const [spaced] of COMPOUNDS) expect(spaced.includes(ZWNJ)).toBe(false);
    expect(ZWNJ).toBe(Z);
  });

  it("idempotent", () => {
    const inputs = [
      ...SAMPLE_NAMES,
      "سرخ کن های تفال",
      "ویژگی ها",
      "می شود",
      `ویژگی${Z}ها`,
      "",
      "بی نظیر",
    ];
    for (const input of inputs) {
      const once = faZwnj(input);
      expect(faZwnj(once)).toBe(once);
      expect(faZwnj(faZwnj(once))).toBe(once);
    }
  });

  it("leaves Latin and digits alone", () => {
    const table = ["Dyson V15", "", "HS08", "۱۲ ۳۴", "Smeg KLF04 · ECF01", "1234"];
    for (const input of table) expect(faZwnj(input)).toBe(input);
    expect(faZwnj("قهوه ساز اسمگ ECF01")).toContain("ECF01");
    expect(faZwnj("۱۲ تا")).toBe("۱۲ تا");
  });

  it("collapses double ZWNJ", () => {
    expect(faZwnj(`ویژگی${Z}${Z}ها`)).toBe(`ویژگی${Z}ها`);
    expect(faZwnj(`ویژگی${Z} ها`)).toBe(`ویژگی${Z}ها`);
    expect(faZwnj(`${Z}ویژگی ها${Z}`)).toBe(`ویژگی${Z}ها`);
    // rule 4 drops the ZWNJ but faZwnj never collapses whitespace (see "دستگاه ها  و")
    expect(faZwnj(`کتری ${Z} برقی`)).toBe("کتری" + "  " + "برقی");
  });

  it("hasMissingZwnj", () => {
    expect(hasMissingZwnj("ویژگی ها")).toBe(true);
    expect(hasMissingZwnj(`ویژگی${Z}ها`)).toBe(false);
    expect(hasMissingZwnj("سرخ کن")).toBe(true);
    expect(hasMissingZwnj("Dyson V15")).toBe(false);
    expect(hasMissingZwnj("")).toBe(false);
  });
});
