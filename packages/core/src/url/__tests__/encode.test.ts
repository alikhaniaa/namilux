import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decPath,
  encPath,
  encSeg,
  ensureTrailingSlash,
  isEncodedCanonical,
  lowerHex,
  pathOnly,
  stripTrailingSlash,
} from "../encode";

type InventoryRow = { oldUrl: string; path: string; type: string };

const INVENTORY_URL = new URL("../../../../../data/extract/01_sitemap/url-inventory-and-redirect-map.csv", import.meta.url);

/** The CSV is written with a UTF-8 BOM; it is read-only input and must never be rewritten. */
const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function readInventory(): InventoryRow[] {
  const raw = stripBom(readFileSync(fileURLToPath(INVENTORY_URL), "utf8"));
  return raw
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(1)
    .map((line) => {
      const f = line.split(",");
      return { oldUrl: f[0] ?? "", path: f[1] ?? "", type: f[2] ?? "" };
    });
}

const INVENTORY = readInventory();

describe("lowerHex", () => {
  it("lowers only %XX triplets", () => {
    expect(lowerHex("%D8%AA-AB")).toBe("%d8%aa-AB");
    expect(lowerHex("%da%a9")).toBe("%da%a9");
    expect(lowerHex("NL-7Q2F4")).toBe("NL-7Q2F4");
    expect(lowerHex("")).toBe("");
  });
});

describe("encSeg lowercase hex table", () => {
  const table: [string, string][] = [
    ["کتری-برقی", "%da%a9%d8%aa%d8%b1%db%8c-%d8%a8%d8%b1%d9%82%db%8c"],
    ["smeg", "smeg"],
    ["a b", "a%20b"],
    ["a/b", "a%2fb"],
    ["مشکی", "%d9%85%d8%b4%da%a9%db%8c"],
    ["a-_.~", "a-_.~"],
    ["", ""],
  ];
  for (const [input, expected] of table) {
    it(`encSeg(${JSON.stringify(input)})`, () => {
      expect(encSeg(input)).toBe(expected);
    });
  }

  it("never emits an uppercase hex digit", () => {
    const enc = encSeg("توستر");
    expect(enc).toBe("%d8%aa%d9%88%d8%b3%d8%aa%d8%b1");
    expect(/[A-F]/.test(enc)).toBe(false);
    expect(enc).toBe(enc.toLowerCase());
  });

  it("does not treat an already-encoded segment as encoded (callers pass decoded input)", () => {
    expect(encSeg("%d8")).toBe("%25d8");
  });
});

describe("encPath keeps slashes", () => {
  it("encodes each non-empty segment and keeps leading/trailing slashes", () => {
    expect(encPath("/product/کتری/")).toBe("/product/%da%a9%d8%aa%d8%b1%db%8c/");
  });

  it("keeps the 4 slashes of a two-level category path", () => {
    const out = encPath("/category/توستر-اسمگ/توستر-کوچک-اسمگ/");
    expect(out.split("/")).toHaveLength(5); // "", category, seg, seg, ""
    expect((out.match(/\//g) ?? []).length).toBe(4);
    expect(out.startsWith("/category/%d8%aa")).toBe(true);
    expect(out.endsWith("/")).toBe(true);
  });

  it("leaves an already-ASCII path untouched", () => {
    expect(encPath("/shop/")).toBe("/shop/");
    expect(encPath("/")).toBe("/");
    expect(encPath("")).toBe("");
  });
});

describe("decPath roundtrip and malformed", () => {
  it("decodes each segment", () => {
    expect(decPath("/product/%da%a9%d8%aa%d8%b1%db%8c/")).toBe("/product/کتری/");
  });

  it("returns a malformed percent-sequence unchanged and never throws", () => {
    expect(decPath("/x/%zz/")).toBe("/x/%zz/");
    expect(decPath("/x/%/")).toBe("/x/%/");
    expect(decPath("/x/%e0%a4%a/")).toBe("/x/%e0%a4%a/");
    expect(() => decPath("%%%")).not.toThrow();
  });

  it('does NOT turn "+" into a space', () => {
    expect(decPath("/a+b/")).toBe("/a+b/");
  });

  it("round-trips decoded → encoded → decoded", () => {
    const decoded = "/category/توستر-اسمگ/توستر-کوچک-اسمگ/";
    expect(decPath(encPath(decoded))).toBe(decoded);
  });
});

describe("isEncodedCanonical", () => {
  it("rejects uppercase hex and accepts lowercase hex", () => {
    expect(isEncodedCanonical("/product/%DA%A9/")).toBe(false);
    expect(isEncodedCanonical("/product/%da%a9/")).toBe(true);
  });

  it("rejects a decoded (unencoded) Persian path", () => {
    expect(isEncodedCanonical("/product/کتری/")).toBe(false);
  });

  it("accepts a pure-ASCII path", () => {
    expect(isEncodedCanonical("/shop/")).toBe(true);
  });
});

describe("ensureTrailingSlash with query and hash", () => {
  const table: [string, string][] = [
    ["/shop", "/shop/"],
    ["/shop/", "/shop/"],
    ["/shop/?page=2", "/shop/?page=2"],
    ["/shop?page=2", "/shop/?page=2"],
    ["", "/"],
    ["/", "/"],
    ["/shop#top", "/shop/#top"],
    ["/shop/#top", "/shop/#top"],
    ["?q=1", "/?q=1"],
  ];
  for (const [input, expected] of table) {
    it(`ensureTrailingSlash(${JSON.stringify(input)})`, () => {
      expect(ensureTrailingSlash(input)).toBe(expected);
    });
  }
});

describe("stripTrailingSlash", () => {
  it('drops one trailing slash but keeps "/"', () => {
    expect(stripTrailingSlash("/shop/")).toBe("/shop");
    expect(stripTrailingSlash("/shop")).toBe("/shop");
    expect(stripTrailingSlash("/")).toBe("/");
    expect(stripTrailingSlash("")).toBe("");
  });
});

describe("pathOnly", () => {
  it("cuts at the first ? or #", () => {
    expect(pathOnly("/shop/?page=2")).toBe("/shop/");
    expect(pathOnly("/shop/#top")).toBe("/shop/");
    expect(pathOnly("/shop/")).toBe("/shop/");
  });
});

describe("the 752-URL inventory", () => {
  it("has 752 rows", () => {
    expect(INVENTORY).toHaveLength(752);
  });

  it("every inventory path is already in the canonical encoded form", () => {
    const offenders = INVENTORY.filter((r) => !isEncodedCanonical(r.path));
    expect(offenders).toEqual([]);
  });

  it("every inventory path round-trips decPath → encPath byte-for-byte", () => {
    const offenders = INVENTORY.filter((r) => encPath(decPath(r.path)) !== r.path);
    expect(offenders).toEqual([]);
  });

  it("every product slug in data/extract encodes to its inventory URL (sample of 50)", () => {
    const products = INVENTORY.filter((r) => r.type === "product");
    expect(products.length).toBeGreaterThanOrEqual(500);
    const step = Math.ceil(products.length / 50);
    const sample = products.filter((_, i) => i % step === 0).slice(0, 50);
    expect(sample).toHaveLength(50);
    for (const row of sample) {
      // split the ENCODED path first, then decode each segment - a "%2f" inside a slug must not
      // become a path separator.
      const decodedSlug = decPath(row.path.split("/").filter(Boolean)[1] ?? "");
      expect(decodedSlug).not.toBe("");
      expect(`/product/${encSeg(decodedSlug)}/`).toBe(row.path);
    }
  });

  it("the encoded path is the tail of the live old_url", () => {
    for (const row of INVENTORY.slice(0, 100)) {
      expect(row.oldUrl.endsWith(row.path)).toBe(true);
    }
  });
});
