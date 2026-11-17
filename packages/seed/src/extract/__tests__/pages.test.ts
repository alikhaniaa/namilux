import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import { ABOUT_BODY_HTML, PAGE_POLICY, PUBLISHED_PAGE_SLUGS, type LegacyPage, readLegacyPages } from "../pages.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "pagesJson"));

describe("PAGE_POLICY (data)", () => {
  it("policy keyed by decoded slug", () => {
    expect(Object.keys(PAGE_POLICY)).toContain("حریم-خصوصی-کاربران");
    expect(Object.keys(PAGE_POLICY)).toContain("قوانین-و-مقررات-نامی-لوکس");
    expect(Object.keys(PAGE_POLICY)).toContain("تست");
    for (const key of Object.keys(PAGE_POLICY)) expect(/%[0-9a-f]{2}/i.test(key)).toBe(false);
  });

  it("4 published with templates, 11 archived, every entry carries a reason", () => {
    expect(Object.keys(PAGE_POLICY)).toHaveLength(15);
    expect(PUBLISHED_PAGE_SLUGS).toHaveLength(4);
    expect([...PUBLISHED_PAGE_SLUGS].sort()).toEqual(
      ["about-us", "contact-us", "حریم-خصوصی-کاربران", "قوانین-و-مقررات-نامی-لوکس"].sort(),
    );
    expect(PAGE_POLICY["about-us"]?.template).toBe("about");
    expect(PAGE_POLICY["contact-us"]?.template).toBe("contact");
    expect(PAGE_POLICY["حریم-خصوصی-کاربران"]?.template).toBe("privacy");
    expect(PAGE_POLICY["قوانین-و-مقررات-نامی-لوکس"]?.template).toBe("terms");
    expect(Object.values(PAGE_POLICY).filter((p) => !p.publish)).toHaveLength(11);
    for (const p of Object.values(PAGE_POLICY)) expect(p.reason.length).toBeGreaterThan(0);
  });

  it("about-us is the one page whose body the policy replaces, and the prose names no brand", () => {
    // The legacy body claimed the shop was the agent of exactly two brands and named them; the
    // catalogue is at five. The rewritten prose leaves the list to the `brands` table, so this
    // asserts the prose stays brand-free rather than asserting its wording.
    expect(PAGE_POLICY["about-us"]?.body).toBe(ABOUT_BODY_HTML);
    for (const brand of ["Smeg", "اسمگ", "Dyson", "دایسون", "Ninja", "Sage", "Figaro"]) {
      expect(ABOUT_BODY_HTML).not.toContain(brand);
    }
    // Persian digits only - `pnpm check:forbidden` polices UI copy, and page prose is copy too.
    expect(/[0-9]/.test(ABOUT_BODY_HTML.replace(/<[^>]*>/g, ""))).toBe(false);
    // Exactly one policy carries a body; every other page keeps its legacy export verbatim.
    expect(Object.values(PAGE_POLICY).filter((p) => p.body !== undefined)).toHaveLength(1);
  });

  it("the about prose is four plain paragraphs and reaches for no figure of speech", () => {
    // The owner rejected the first rewrite for its voice, not its facts. These are the marks he
    // named: the essayist's turn, the aside set off by an em dash or a colon, the idiom. A future
    // edit that brings one back fails here rather than on the live site.
    const paras = ABOUT_BODY_HTML.split("\n");
    expect(paras).toHaveLength(4);
    for (const p of paras) expect(p).toMatch(/^<p>[^<]+<\/p>$/u);
    for (const flourish of ["—", ":", "؛ ", "ما همه‌چیز", "به‌درد", "به دل", "رک ", "خانهٔ"]) {
      expect(ABOUT_BODY_HTML).not.toContain(flourish);
    }
  });

  it("my-account, billing and wishlist are archived because routes serve their URLs", () => {
    expect(PAGE_POLICY["my-account"]?.publish).toBe(false);
    expect(PAGE_POLICY["billing"]?.publish).toBe(false);
    expect(PAGE_POLICY["wishlist"]?.publish).toBe(false);
    expect(PAGE_POLICY["discount"]?.publish).toBe(false);
  });
});

describe.skipIf(!hasExtract)("real pages.json", () => {
  let pages: LegacyPage[];
  let warnings: string[];

  beforeAll(async () => {
    const res = await readLegacyPages(dir);
    pages = res.pages;
    warnings = res.warnings;
  });

  it("reads all 15 legacy pages so the M0 gate counts 15", () => {
    expect(pages).toHaveLength(15);
    expect(warnings).toEqual([]);
    expect(new Set(pages.map((p) => p.id)).size).toBe(15);
  });

  it("4 published with templates, 11 archived", () => {
    const published = pages.filter((p) => p.publish);
    expect(published).toHaveLength(4);
    expect(published.map((p) => `${p.slug}:${p.template}`).sort()).toEqual(
      [
        "about-us:about",
        "contact-us:contact",
        "حریم-خصوصی-کاربران:privacy",
        "قوانین-و-مقررات-نامی-لوکس:terms",
      ].sort(),
    );
    expect(pages.filter((p) => !p.publish)).toHaveLength(11);
  });

  it("about-us is read with the policy body, not the Elementor export", () => {
    const about = pages.find((p) => p.slug === "about-us");
    expect(about?.contentHtml).toBe(ABOUT_BODY_HTML);
    expect(about?.contentHtml).not.toContain("elementor");
  });

  it("keeps id, decoded slug, root path and the raw body of archived rows", () => {
    for (const p of pages) {
      expect(/%[0-9a-f]{2}/i.test(p.slug)).toBe(false);
      expect(p.path).toBe(`/${p.slug}/`);
      expect(typeof p.contentHtml).toBe("string");
      expect(p.title.includes("<")).toBe(false);
      expect(p.reason.length).toBeGreaterThan(0);
    }
    // "billing" is a 32-byte shortcode body - kept, not published.
    const billing = pages.find((p) => p.slug === "billing") as LegacyPage;
    expect(billing.publish).toBe(false);
    expect(billing.contentHtml.length).toBeLessThan(200);
    // "wishlist" has a Latin title and is still archived.
    const wishlist = pages.find((p) => p.slug === "wishlist") as LegacyPage;
    expect(wishlist.publish).toBe(false);
  });

  it("published pages keep their Elementor markup for the sanitizer", () => {
    // about-us excepted: the policy threw its export away, and what replaced it is four short
    // paragraphs of plain prose - deliberately far under the length an Elementor body runs to.
    for (const p of pages.filter((x) => x.publish && x.slug !== "about-us")) {
      expect(p.contentHtml.length).toBeGreaterThan(1000);
    }
  });

  it("dates are the legacy dates in ISO UTC", () => {
    for (const p of pages) {
      expect(p.publishedAt === null || p.publishedAt.endsWith("Z")).toBe(true);
      expect(p.modifiedAt === null || p.modifiedAt.endsWith("Z")).toBe(true);
    }
  });

  it("unknown slug warns and archives", async () => {
    // The 14 Aug extract has no unknown slug; assert the rule through the exported policy default.
    const { UNKNOWN_PAGE_POLICY } = await import("../pages.js");
    expect(UNKNOWN_PAGE_POLICY).toEqual({ template: "default", publish: false, reason: "unknown legacy page" });
    expect(pages.every((p) => p.reason !== UNKNOWN_PAGE_POLICY.reason)).toBe(true);
  });
});
