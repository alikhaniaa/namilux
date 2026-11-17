import { describe, expect, it } from "vitest";
import { dimsFromSpecs, specsFromAttributes, splitFusedValue } from "../specs.js";

describe("legacy product specs", () => {
  it("newline + header grouping", () => {
    const result = specsFromAttributes([{ label: "سایر مشخصات", rawValue: "صافی جدا شونده\nپایه ضدلغزش\nاقلام همراه:\nدفترچه راهنما" }]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toMatchObject({ groupName: "اقلام همراه", value: "دفترچه راهنما" });
  });

  it("comma split", () => {
    expect(splitFusedValue("تنظیم باد سرد, سه سرعت, کنترل هوشمند حرارت")).toEqual([
      "تنظیم باد سرد",
      "سه سرعت",
      "کنترل هوشمند حرارت",
    ]);
  });

  it("decimal comma preserved", () => {
    expect(splitFusedValue("1,5 لیتر")).toEqual(["1,5 لیتر"]);
  });

  it("trailing separator", () => {
    expect(splitFusedValue("اول، دوم، ")).toEqual(["اول", "دوم"]);
  });

  it("non-spec labels skipped", () => {
    expect(specsFromAttributes([{ label: "برند", rawValue: "اسمگ" }]).rows).toEqual([]);
  });

  it("cap 40", () => {
    expect(splitFusedValue(Array.from({ length: 45 }, (_, index) => `مورد ${index}`).join("،")).length).toBe(40);
  });

  it("dedupe by faNorm", () => {
    expect(splitFusedValue("ویژگی يک، ویژگی یک")).toEqual(["ویژگی يک"]);
  });

  it.each([
    ["طول", "28 سانتی متر", { lengthMm: 280, widthMm: null, heightMm: null, weightG: null }],
    ["ارتفاع", "4.5 سانتی متر", { lengthMm: null, widthMm: null, heightMm: 45, weightG: null }],
    ["وزن", "1.2 کیلوگرم", { lengthMm: null, widthMm: null, heightMm: null, weightG: 1200 }],
    ["وزن", "۸۰۰ گرم", { lengthMm: null, widthMm: null, heightMm: null, weightG: 800 }],
    ["ابعاد", "30×20×15 سانتی متر", { lengthMm: 300, widthMm: 200, heightMm: 150, weightG: null }],
  ])("dims parsing table: %s", (label, value, expected) => {
    expect(dimsFromSpecs([{ label, value, groupName: null, sort: 0 }])).toEqual(expected);
  });
});
