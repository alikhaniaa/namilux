import { describe, expect, it } from "vitest";

import {
  extractModelCode,
  groupByModelKey,
  modelKey,
} from "../model-key";

describe("model key transform", () => {
  it.each([
    ["کتری اسمگ KLF04BL", "KLF04BL"],
    ["ایرپ دایسون hs08", "HS08"],
    ["جارو دایسون V16", "V16"],
    ["سوداساز سیج sca 800 btr", "SCA800BTR"],
    ["تصفیه هوا PH04", "PH04"],
    ["خردکن BC251", "BC251"],
    ["قهوه ساز ECF03", "ECF03"],
    ["کتری KLF-03-CR", "KLF03CR"],
    ["فر مدل SFP 9301 X", "SFP9301X"],
    ["بدون کد مدل", null],
  ])("code table (10 names): %s", (name, expected) => {
    expect(extractModelCode(name)).toBe(expected);
  });

  it("stoplist", () => {
    expect(extractModelCode("tefal masterchop xxl خردکن تفال")).toBeNull();
    expect(extractModelCode("تلویزیون 4K با بسته 2X و تصویر 3D")).toBeNull();
    expect(extractModelCode("موتور پر قدرت V9")).toBeNull();
    expect(extractModelCode("چراغ LED و درگاه USB")).toBeNull();
  });

  it("sku precedence", () => {
    expect(extractModelCode("کتری اسمگ KLF04", "KLF04BLEU")).toBe("KLF04BLEU");
    expect(extractModelCode("کتری اسمگ KLF04", "not-a-model")).toBe("KLF04");
  });

  it("KLF03 groups eleven", () => {
    const colors = [
      "کرم",
      "مشکی",
      "سفید",
      "قرمز",
      "سبز",
      "آبی",
      "صورتی",
      "طوسی",
      "طلایی",
      "مسی",
      "نقره‌ای",
    ];
    const items = colors.map((color, index) => ({
      id: index + 1,
      key: modelKey(`کتری برقی ساده اسمگ KLF03 رنگ ${color}`),
      brandSlug: "smeg",
      buyable: true,
      hasImage: true,
      price: 1_000 + index,
    }));

    expect(new Set(items.map(({ key }) => key))).toEqual(new Set(["smeg klf03"]));
    expect(groupByModelKey(items)).toEqual([
      { key: "smeg klf03", ids: colors.map((_, index) => index + 1), primaryId: 1, brandSlug: "smeg" },
    ]);
  });


  it("primary selection priority", () => {
    const base = { key: "smeg klf03", brandSlug: "smeg" } as const;
    const groups = groupByModelKey([
      { ...base, id: 1, buyable: false, hasImage: true, price: 1 },
      { ...base, id: 2, buyable: true, hasImage: false, price: 1 },
      { ...base, id: 3, buyable: true, hasImage: true, price: 20 },
      { ...base, id: 4, buyable: true, hasImage: true, price: 10 },
      { ...base, id: 5, buyable: true, hasImage: true, price: 10 },
    ]);

    expect(groups[0]?.primaryId).toBe(4);
  });

  it("brand split", () => {
    const groups = groupByModelKey([
      { id: 1, key: "ecf01", brandSlug: "smeg", buyable: true, hasImage: true, price: 10 },
      { id: 2, key: "ecf01", brandSlug: "smeg", buyable: true, hasImage: true, price: 20 },
      { id: 3, key: "ecf01", brandSlug: "figaro", buyable: true, hasImage: true, price: 10 },
      { id: 4, key: "ecf01", brandSlug: "figaro", buyable: true, hasImage: true, price: 20 },
      { id: 5, key: "ecf01", brandSlug: null, buyable: true, hasImage: true, price: 10 },
    ]);

    expect(groups).toEqual([
      { key: "ecf01", ids: [3, 4], primaryId: 3, brandSlug: "figaro" },
      { key: "ecf01", ids: [1, 2], primaryId: 1, brandSlug: "smeg" },
    ]);
  });

  it("deterministic", () => {
    const items = [
      { id: 8, key: "b", brandSlug: null, buyable: true, hasImage: true, price: 2 },
      { id: 7, key: "b", brandSlug: null, buyable: true, hasImage: true, price: 2 },
      { id: 2, key: "a", brandSlug: "smeg", buyable: false, hasImage: false, price: 2 },
      { id: 1, key: "a", brandSlug: "smeg", buyable: false, hasImage: false, price: 1 },
    ];

    expect(groupByModelKey(items)).toEqual(groupByModelKey([...items].reverse()));
  });
});
