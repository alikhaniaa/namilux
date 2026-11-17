import { describe, expect, it } from "vitest";
import { WORDS_PER_MINUTE, firstParagraph, htmlToText, readMinutes, splitListItems, wordCount } from "../text";

const ZWNJ = "‌";

describe("htmlToText table", () => {
  const rows: [string, string][] = [
    ["<p>سلام <strong>دنیا</strong></p><p>دوم</p>", "سلام دنیا دوم"],
    ["<ul><li>یک</li><li>دو</li></ul>", "یک دو"],
    ["<ol><li>یک</li><li>دو</li><li>سه</li></ol>", "یک دو سه"],
    ["<h2>عنوان</h2><p>متن</p>", "عنوان متن"],
    ["<table><tr><td>a</td><td>b</td></tr></table>", "a b"],
    ["<p>a<br>b</p>", "a b"],
    ["<blockquote>نقل</blockquote>", "نقل"],
    ["<p>   فاصله    زیاد   </p>", "فاصله زیاد"],
    ["متن بدون تگ", "متن بدون تگ"],
    ["<p></p><p> </p>", ""],
    ["", ""],
    ["<script>x</script>y", "x y"],
    ["<!-- comment -->متن", "متن"],
  ];

  for (const [input, want] of rows) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
      expect(htmlToText(input)).toBe(want);
    });
  }

  it("never fuses adjacent list items", () => {
    expect(htmlToText("<ul><li>یک</li><li>دو</li></ul>")).not.toBe("یکدو");
  });

  it("returns '' for null, undefined and non-strings", () => {
    expect(htmlToText(null as unknown as string)).toBe("");
    expect(htmlToText(undefined as unknown as string)).toBe("");
    expect(htmlToText(7 as unknown as string)).toBe("");
  });
});

describe("entity decoding incl. zwnj", () => {
  const rows: [string, string][] = [
    ["a&nbsp;b &amp; c &#1740;", "a b & c ی"],
    [`ویژگی&zwnj;ها`, `ویژگی${ZWNJ}ها`],
    ["&lt;p&gt;", "<p>"],
    ["&quot;نقل&quot;", '"نقل"'],
    ["it&#39;s", "it's"],
    ["&#x6cc;", "ی"],
    ["&#X6CC;", "ی"],
    ["&laquo;نامیلوکس&raquo;", "«نامیلوکس»"],
    ["&hellip;", "…"],
    ["&amp;lt;script&amp;gt;", "&lt;script&gt;"],
    ["&notarealentity;", "&notarealentity;"],
    ["&#0;", "&#0;"],
    ["&#xD800;", "&#xD800;"],
  ];

  for (const [input, want] of rows) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
      expect(htmlToText(input)).toBe(want);
    });
  }

  it("keeps ZWNJ (it is not whitespace) but collapses NBSP", () => {
    expect(htmlToText(`<p>نیم&zwnj;فاصله</p>`)).toBe(`نیم${ZWNJ}فاصله`);
    expect(htmlToText("<p>a&nbsp;&nbsp;b</p>")).toBe("a b");
  });
});

describe("htmlToText maxWords", () => {
  it("truncates at a word boundary with an ellipsis", () => {
    expect(htmlToText("<p>یک دو سه چهار</p>", 2)).toBe("یک دو…");
  });

  it("leaves a short text untouched", () => {
    expect(htmlToText("<p>یک دو</p>", 5)).toBe("یک دو");
  });
});

describe("splitListItems table", () => {
  const rows: [string, string[]][] = [
    ["<ul><li>صافی قابل جداشدن</li><li>پایه ضدلغزش</li></ul>", ["صافی قابل جداشدن", "پایه ضدلغزش"]],
    ["صافی قابل جداشدن<br>پایه ضدلغزش<br/>امکان تنظیم", ["صافی قابل جداشدن", "پایه ضدلغزش", "امکان تنظیم"]],
    ["<p>یک</p><p>دو</p>", ["یک", "دو"]],
    ["• یک • دو", ["یک", "دو"]],
    ["یک · دو", ["یک", "دو"]],
    ["یک\nدو\r\nسه", ["یک", "دو", "سه"]],
    ["فقط متن", ["فقط متن"]],
    ["", []],
    ["   ", []],
    ["<ul></ul>", []],
  ];

  for (const [input, want] of rows) {
    it(`${JSON.stringify(input)} → ${want.length} item(s)`, () => {
      expect(splitListItems(input)).toEqual(want);
    });
  }

  it("never splits on the Persian comma or semicolon (prose punctuation)", () => {
    expect(splitListItems("صافی، قابل جداشدن؛ ضدلغزش")).toEqual(["صافی، قابل جداشدن؛ ضدلغزش"]);
  });

  it("de-duplicates by faNorm equality", () => {
    expect(splitListItems("<li>یک</li><li>یک</li>")).toEqual(["یک"]);
    expect(splitListItems("<li>كتري</li><li>کتری</li>")).toEqual(["كتري"]);
  });

  it("returns [] for null and undefined", () => {
    expect(splitListItems(null as unknown as string)).toEqual([]);
    expect(splitListItems(undefined as unknown as string)).toEqual([]);
  });
});

describe("wordCount / readMinutes", () => {
  it("counts words of the text, not of the markup", () => {
    expect(wordCount("<p>یک <strong>دو</strong> سه</p>")).toBe(3);
    expect(wordCount("")).toBe(0);
    expect(wordCount("<p></p>")).toBe(0);
  });

  const rows: [string, number][] = [
    [`<p>${"کلمه ".repeat(450)}</p>`, 3],
    ["<p>کوتاه</p>", 1],
    ["", 1],
    [`<p>${"کلمه ".repeat(WORDS_PER_MINUTE)}</p>`, 1],
    [`<p>${"کلمه ".repeat(WORDS_PER_MINUTE + 1)}</p>`, 2],
  ];

  for (const [input, want] of rows) {
    it(`readMinutes(${input.slice(0, 24)}…) → ${want}`, () => {
      expect(readMinutes(input)).toBe(want);
    });
  }

  it("is never less than one minute", () => {
    expect(readMinutes("<p></p>")).toBe(1);
  });
});

describe("firstParagraph", () => {
  it("returns the first non-empty paragraph", () => {
    expect(firstParagraph("<h2>t</h2><p></p><p>اول</p><p>دوم</p>")).toBe("اول");
  });

  it("strips inline markup inside the paragraph", () => {
    expect(firstParagraph("<p>اول <strong>پررنگ</strong></p>")).toBe("اول پررنگ");
  });

  it("falls back to the first line when there is no paragraph", () => {
    expect(firstParagraph("<h2>عنوان</h2>خط دوم")).toBe("عنوان");
    expect(firstParagraph("متن ساده")).toBe("متن ساده");
  });

  it("returns '' for empty and non-string input", () => {
    expect(firstParagraph("")).toBe("");
    expect(firstParagraph(null as unknown as string)).toBe("");
    expect(firstParagraph("<p></p>")).toBe("");
  });
});
