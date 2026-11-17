import { describe, expect, it } from "vitest";
import { GATEWAY_FOR_CHANNEL, MAIN_SITE_HOST, isSalesChannel, replaceMainSite, replaceMainSiteDeep } from "../channel";
import { CANONICAL_ORIGIN } from "../constants";

describe("channel", () => {
  it("each storefront settles through exactly one gateway", () => {
    expect(GATEWAY_FOR_CHANNEL).toEqual({ main: "zarinpal", instalments: "snapppay" });
    expect(isSalesChannel("instalments")).toBe(true);
    expect(isSalesChannel("both")).toBe(false);
  });

  it("MAIN_SITE_HOST is the canonical origin's host", () => {
    expect(`https://${MAIN_SITE_HOST}`).toBe(CANONICAL_ORIGIN);
  });
});

describe("replaceMainSite - the instalment site never prints namilux.ir", () => {
  const origin = "https://namilux2.ir";

  it("moves absolute and protocol-relative links, on www too, to the instalment origin", () => {
    // shapes found in the live product descriptions on 15 Sep 2026
    const html =
      '<a href="https://namilux.ir/brand/smeg/">اسمگ</a>' +
      '<img src="https://namilux.ir/wp-content/uploads/2024/05/x-300x300.webp">' +
      '<a href="http://www.namilux.ir/category/%d9%86/">x</a><a href="//namilux.ir/">y</a>';
    expect(replaceMainSite(html, origin)).toBe(
      '<a href="https://namilux2.ir/brand/smeg/">اسمگ</a>' +
        '<img src="https://namilux2.ir/wp-content/uploads/2024/05/x-300x300.webp">' +
        '<a href="https://namilux2.ir/category/%d9%86/">x</a><a href="https://namilux2.ir/">y</a>',
    );
  });

  it("replaces the host in running text, in any case, at the end of a sentence", () => {
    expect(replaceMainSite("خرید تنها از طریق سایت namilux.ir امکان پذیر است.", origin)).toBe("خرید تنها از طریق سایت namilux2.ir امکان پذیر است.");
    expect(replaceMainSite("<strong>NAMILUX.IR</strong>", origin)).toBe("<strong>namilux2.ir</strong>");
    expect(replaceMainSite("www.namilux.ir.", origin)).toBe("namilux2.ir.");
    // visible link text that repeats the URL
    expect(replaceMainSite('<a href="https://namilux.ir/v.mp4">https://namilux.ir/v.mp4</a>', origin)).toBe(
      '<a href="https://namilux2.ir/v.mp4">https://namilux2.ir/v.mp4</a>',
    );
  });

  it("leaves no form of the main host behind: handles, addresses, subdomains", () => {
    // the live terms page names two Instagram accounts; on the instalment site they are one, its own
    expect(replaceMainSite("فعالیت نامی‌لوکس در اینستاگرام تنها با اکانت‌های namilux.ir2 و namilux.ir می‌باشد.", origin)).toBe(
      "فعالیت نامی‌لوکس در اینستاگرام تنها با اکانت‌های namilux2.ir می‌باشد.",
    );
    expect(replaceMainSite("instagram.com/namilux.ir", origin)).toBe("instagram.com/namilux2.ir");
    expect(replaceMainSite("info@namilux.ir", origin)).toBe("info@namilux2.ir");
    expect(replaceMainSite("admin.namilux.ir", origin)).toBe("admin.namilux2.ir");
    for (const text of ["خرید از namilux.ir", "namilux.ir2", "NAMILUX.IR2"]) {
      expect(replaceMainSite(text, origin)).not.toMatch(/(^|[^\w])namilux\.ir/iu);
    }
  });

  it("leaves longer words that only contain the host alone", () => {
    for (const text of ["namilux.iran", "mynamilux.ir", "namilux2.ir"]) {
      expect(replaceMainSite(text, origin)).toBe(text);
    }
  });

  it("is safe to run twice and on an origin with a port or a trailing slash", () => {
    const once = replaceMainSite("https://namilux.ir/x namilux.ir", origin);
    expect(replaceMainSite(once, origin)).toBe(once);
    expect(replaceMainSite("https://namilux.ir/x namilux.ir", "https://203.0.113.20:8200/")).toBe("https://203.0.113.20:8200/x 203.0.113.20:8200");
  });

  it("does not loop on an origin that is itself under namilux.ir", () => {
    expect(replaceMainSite("https://namilux.ir/x", "https://aghsat.namilux.ir")).toBe("https://aghsat.namilux.ir/x");
  });
});

describe("replaceMainSiteDeep - the data a page serialises, not only what it renders", () => {
  const origin = "https://namilux2.ir";

  it("rewrites every string in nested objects and arrays and keeps everything else", () => {
    const when = new Date("2026-09-15T12:00:00Z");
    const detail = {
      id: 117,
      price: 115_000_000,
      descriptionHtml: '<a href="https://namilux.ir/brand/smeg/">اسمگ</a>',
      specs: [{ label: "سایت", value: "namilux.ir" }],
      faq: [["پرسش", "پاسخ در namilux.ir/account"]],
      publishedAt: when,
      compareAt: null,
      available: true,
    };
    const out = replaceMainSiteDeep(detail, origin);
    expect(out.descriptionHtml).toBe('<a href="https://namilux2.ir/brand/smeg/">اسمگ</a>');
    expect(out.specs[0]?.value).toBe("namilux2.ir");
    expect(out.faq[0]?.[1]).toBe("پاسخ در namilux2.ir/account");
    expect(out.publishedAt).toBe(when);
    expect(out).toMatchObject({ id: 117, price: 115_000_000, compareAt: null, available: true });
    expect(JSON.stringify(out)).not.toMatch(/(^|[^\w])namilux\.ir/u);
    // the input is not mutated
    expect(detail.descriptionHtml).toContain("https://namilux.ir/");
  });
});
