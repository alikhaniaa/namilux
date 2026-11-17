import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

// DECISION: ../persian/phone is owned by another module and not yet built when this was written; mocking it with its
// documented behaviour keeps these tests a unit test of routes.ts.
vi.mock("../../persian/phone", () => ({
  phoneToE164: (phone: string): string => {
    if (!/^09[0-39]\d{8}$/.test(phone)) throw new RangeError("phoneToE164: phone must be normalized");
    return `+98${phone.slice(1)}`;
  },
}));

import {
  ROUTES,
  absUrl,
  brandUrl,
  categoryUrl,
  collectionUrl,
  conciergeText,
  invoiceUrl,
  legacyMyAccountRedirect,
  legacyPaginationRedirect,
  mediaUrl,
  orderUrl,
  orderWhatsappText,
  pageN,
  pageUrl,
  payUrl,
  postUrl,
  productUrl,
  resultUrl,
  searchUrl,
  telUrl,
  trackUrl,
  whatsappUrl,
} from "../routes";
import { decPath } from "../encode";

type InventoryRow = { path: string; type: string };

const INVENTORY_URL = new URL("../../../../../data/extract/01_sitemap/url-inventory-and-redirect-map.csv", import.meta.url);
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const INVENTORY: InventoryRow[] = stripBom(readFileSync(fileURLToPath(INVENTORY_URL), "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.length > 0)
  .slice(1)
  .map((line) => {
    const f = line.split(",");
    return { path: f[1] ?? "", type: f[2] ?? "" };
  });

/** decoded, slash-free segments of an inventory path */
const decodedSegments = (path: string): string[] => path.split("/").filter(Boolean).map((seg) => decPath(seg));

describe("ROUTES", () => {
  it("every static route ends with a slash except the file routes", () => {
    const files = new Set<string>([ROUTES.searchIndex, ROUTES.manifest, ROUTES.sitemapIndex, ROUTES.robots]);
    for (const value of Object.values(ROUTES)) {
      if (files.has(value)) expect(value.endsWith("/")).toBe(false);
      else expect(value.endsWith("/")).toBe(true);
      expect(value.startsWith("/")).toBe(true);
    }
  });

  it("checkout lives at /billing/", () => {
    expect(ROUTES.billing).toBe("/billing/");
    expect(Object.values(ROUTES)).not.toContain("/checkout/");
  });
});

describe("entity urls table", () => {
  it("productUrl encodes the slug with lowercase hex", () => {
    expect(productUrl("کتری-برقی")).toBe("/product/%da%a9%d8%aa%d8%b1%db%8c-%d8%a8%d8%b1%d9%82%db%8c/");
  });

  it("brandUrl / collectionUrl stay ASCII for ASCII slugs", () => {
    expect(brandUrl("smeg")).toBe("/brand/smeg/");
    expect(collectionUrl("gifts-under-5m")).toBe("/collection/gifts-under-5m/");
  });

  it("postUrl and pageUrl share the root namespace", () => {
    expect(postUrl("آموزش-طرز-استفاده-از-توستر-اسمگ").startsWith("/%d8%a2")).toBe(true);
    expect(postUrl("warranty")).toBe("/warranty/");
    expect(pageUrl("warranty")).toBe("/warranty/");
  });

  it("categoryUrl is tolerant of leading/trailing slashes and a leading category/ prefix", () => {
    const expected = categoryUrl("توستر-اسمگ/توستر-کوچک-اسمگ");
    expect(expected.startsWith("/category/%d8%aa")).toBe(true);
    expect(expected.endsWith("/")).toBe(true);
    expect(categoryUrl("/category/توستر-اسمگ/توستر-کوچک-اسمگ/")).toBe(expected);
    expect(categoryUrl("/توستر-اسمگ/توستر-کوچک-اسمگ/")).toBe(expected);
    expect(categoryUrl("category/توستر-اسمگ//توستر-کوچک-اسمگ")).toBe(expected);
  });

  it("rejects an empty slug/path instead of minting // (protocol-relative)", () => {
    expect(() => productUrl("")).toThrow(RangeError);
    expect(() => brandUrl("   ")).toThrow(RangeError);
    expect(() => collectionUrl("")).toThrow(RangeError);
    expect(() => postUrl("")).toThrow(RangeError);
    expect(() => pageUrl("")).toThrow(RangeError);
    expect(() => categoryUrl("/category/")).toThrow(RangeError);
    expect(() => categoryUrl("")).toThrow(RangeError);
  });
});

describe("orderUrl validates code", () => {
  it("accepts a canonical order code", () => {
    expect(orderUrl("NL-7Q2F4")).toBe("/account/orders/NL-7Q2F4/");
    expect(invoiceUrl("NL-7Q2F4")).toBe("/account/orders/NL-7Q2F4/invoice/");
    expect(payUrl("NL-7Q2F4")).toBe("/pay/NL-7Q2F4/");
  });

  it("rejects lowercase, ambiguous characters and wrong length", () => {
    for (const bad of ["nl-7q2f4", "NL-7Q2F0", "NL-7Q2F", "NL-7Q2F44", "7Q2F4", "NL-7Q2F4/../x"]) {
      expect(() => orderUrl(bad)).toThrow(RangeError);
      expect(() => invoiceUrl(bad)).toThrow(RangeError);
      expect(() => payUrl(bad)).toThrow(RangeError);
    }
  });
});

describe("resultUrl", () => {
  it("builds the ok / fail / test variants", () => {
    expect(resultUrl("NL-7Q2F4", true)).toBe("/billing/result/?o=NL-7Q2F4&s=ok");
    expect(resultUrl("NL-7Q2F4", false)).toBe("/billing/result/?o=NL-7Q2F4&s=fail");
    expect(resultUrl("NL-7Q2F4", false, true)).toBe("/billing/result/?o=NL-7Q2F4&s=fail&t=1");
    expect(resultUrl("NL-7Q2F4", true, false)).toBe("/billing/result/?o=NL-7Q2F4&s=ok");
  });

  it("percent-encodes a hostile code instead of breaking out of the parameter", () => {
    expect(resultUrl("a&s=ok", false)).toBe("/billing/result/?o=a%26s%3dok&s=fail");
  });
});

describe("trackUrl", () => {
  it("returns /track/ without a code and ?o= with one", () => {
    expect(trackUrl()).toBe("/track/");
    expect(trackUrl("")).toBe("/track/");
    expect(trackUrl("NL-7Q2F4")).toBe("/track/?o=NL-7Q2F4");
    expect(trackUrl("a b")).toBe("/track/?o=a%20b");
  });
});

describe("searchUrl", () => {
  it("encodes the query with lowercase hex", () => {
    expect(searchUrl("توستر")).toBe("/search/?q=%d8%aa%d9%88%d8%b3%d8%aa%d8%b1");
    expect(searchUrl("smeg")).toBe("/search/?q=smeg");
    expect(searchUrl("")).toBe("/search/?q=");
  });
});

describe("pageN", () => {
  it("omits page 1 and appends ?page=N otherwise", () => {
    expect(pageN("/shop/", 1)).toBe("/shop/");
    expect(pageN("/shop/", 0)).toBe("/shop/");
    expect(pageN("/shop/", -3)).toBe("/shop/");
    expect(pageN("/shop/", 2)).toBe("/shop/?page=2");
    expect(pageN("/shop/", 12)).toBe("/shop/?page=12");
  });

  it("never breaks the trailing-slash contract and never doubles the ?", () => {
    expect(pageN("/shop", 2)).toBe("/shop/?page=2");
    expect(pageN("/shop/?brand=smeg", 2)).toBe("/shop/?brand=smeg&page=2");
    expect(pageN("/shop/", Number.NaN)).toBe("/shop/");
    expect(pageN("/shop/", 2.7)).toBe("/shop/?page=2");
  });
});

describe("mediaUrl", () => {
  it("prefixes a content-hashed key without encoding it", () => {
    expect(mediaUrl("p/3f/3fa9c1.avif")).toBe("/media/p/3f/3fa9c1.avif");
    expect(mediaUrl("/p/3f/3fa9c1.avif")).toBe("/media/p/3f/3fa9c1.avif");
  });

  it("rejects traversal, absolute origins and query smuggling", () => {
    for (const bad of ["", "../secret", "p/../../etc", "https://evil.tld/x.png", "data:image/png;base64,AA", "p/a b.png", "p/a?x=1", "p\\a"]) {
      expect(() => mediaUrl(bad)).toThrow(RangeError);
    }
  });
});

describe("absUrl", () => {
  it("joins origin and path", () => {
    expect(absUrl("https://namilux.ir/", "/shop/")).toBe("https://namilux.ir/shop/");
    expect(absUrl("https://namilux.ir", "/shop/")).toBe("https://namilux.ir/shop/");
    expect(absUrl("https://namilux.ir///", "/")).toBe("https://namilux.ir/");
  });

  it("requires an absolute path", () => {
    expect(() => absUrl("https://namilux.ir", "shop/")).toThrow(RangeError);
    expect(() => absUrl("https://namilux.ir", "")).toThrow(RangeError);
  });
});

describe("whatsappUrl and conciergeText", () => {
  it("builds a wa.me link with the E.164 digits and lowercase-hex text", () => {
    expect(whatsappUrl("09121230077", "سلام")).toBe("https://wa.me/989121230077?text=%d8%b3%d9%84%d8%a7%d9%85");
    expect(whatsappUrl("09121230077")).toBe("https://wa.me/989121230077");
    expect(whatsappUrl("09121230077", "")).toBe("https://wa.me/989121230077");
  });

  it("refuses a non-normalized phone", () => {
    expect(() => whatsappUrl("9121230077")).toThrow(RangeError);
    expect(() => telUrl("02155550000")).toThrow(RangeError);
  });

  it("telUrl keeps the + prefix", () => {
    expect(telUrl("09121230077")).toBe("tel:+989121230077");
  });

  it("conciergeText includes the sku only when there is one", () => {
    const url = "https://namilux.ir/product/x/";
    expect(conciergeText({ displayName: "توستر اسمگ", sku: "TSF01", url })).toBe(
      `سلام، دربارهٔ توستر اسمگ (TSF01) سؤال دارم · ${url}`,
    );
    expect(conciergeText({ displayName: "توستر اسمگ", sku: null, url })).toBe(`سلام، دربارهٔ توستر اسمگ سؤال دارم · ${url}`);
    expect(conciergeText({ displayName: "توستر اسمگ", sku: "  ", url })).toBe(`سلام، دربارهٔ توستر اسمگ سؤال دارم · ${url}`);
  });

  it("orderWhatsappText names the order code", () => {
    expect(orderWhatsappText({ code: "NL-7Q2F4" })).toBe("سلام، دربارهٔ سفارش NL-7Q2F4 سؤال دارم");
  });
});

describe("legacy my-account redirects", () => {
  const table: [string, string | null][] = [
    ["/my-account/orders/", "/account/orders/"],
    ["/my-account/edit-address/", "/account/addresses/"],
    ["/my-account/", "/account/"],
    ["/my-account", "/account/"],
    ["/my-account/downloads/", "/account/"],
    ["/my-account/orders/2/", "/account/orders/"],
    ["/my-account/edit-address/billing/", "/account/addresses/"],
    ["/my-account/?foo=1", "/account/"],
    ["/shop/", null],
    ["/", null],
    ["/my-accountant/", null],
  ];
  for (const [input, expected] of table) {
    it(`legacyMyAccountRedirect(${JSON.stringify(input)})`, () => {
      expect(legacyMyAccountRedirect(input)).toBe(expected);
    });
  }
});

describe("legacy pagination redirects", () => {
  const table: [string, string | null][] = [
    ["/shop/page/3/", "/shop/?page=3"],
    ["/shop/page/3", "/shop/?page=3"],
    ["/category/x/page/2/", "/category/x/?page=2"],
    ["/category/a/b/page/10/", "/category/a/b/?page=10"],
    ["/page/2/", "/?page=2"],
    ["/shop/page/0/", "/shop/"],
    ["/shop/page/1/", "/shop/"],
    ["/product/x/", null],
    ["/shop/page/", null],
    ["/shop/page/abc/", null],
    ["/", null],
  ];
  for (const [input, expected] of table) {
    it(`legacyPaginationRedirect(${JSON.stringify(input)})`, () => {
      expect(legacyPaginationRedirect(input)).toBe(expected);
    });
  }
});

describe("the 752-URL inventory is re-mintable from decoded slugs", () => {
  it("540 product rows", () => {
    const rows = INVENTORY.filter((r) => r.type === "product");
    expect(rows).toHaveLength(540);
    for (const row of rows) {
      const segments = decodedSegments(row.path);
      expect(segments[0]).toBe("product");
      expect(productUrl(segments[1] ?? "")).toBe(row.path);
    }
  });

  it("7 brand rows", () => {
    const rows = INVENTORY.filter((r) => r.type === "brand");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      const segments = decodedSegments(row.path);
      expect(segments[0]).toBe("brand");
      expect(brandUrl(segments[1] ?? "")).toBe(row.path);
    }
  });

  it("43 category rows (one and two levels deep)", () => {
    const rows = INVENTORY.filter((r) => r.type === "category");
    expect(rows).toHaveLength(43);
    for (const row of rows) {
      const segments = decodedSegments(row.path);
      expect(segments[0]).toBe("category");
      expect(categoryUrl(segments.slice(1).join("/"))).toBe(row.path);
    }
  });

  it("160 root-namespace post/page rows (home and /locations.kml excluded)", () => {
    const rows = INVENTORY.filter((r) => r.type === "page/post" && r.path !== "/" && r.path.endsWith("/"));
    expect(rows).toHaveLength(160);
    for (const row of rows) {
      const segments = decodedSegments(row.path);
      expect(segments).toHaveLength(1);
      expect(postUrl(segments[0] ?? "")).toBe(row.path);
      expect(pageUrl(segments[0] ?? "")).toBe(row.path);
    }
  });

  it("covers all 752 rows", () => {
    const covered = INVENTORY.filter(
      (r) => r.type === "product" || r.type === "brand" || r.type === "category" || (r.type === "page/post" && r.path.endsWith("/")),
    );
    expect(covered.length + 1).toBe(752); // + /locations.kml, which the spec serves as 410
  });
});
