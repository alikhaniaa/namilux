import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  CATEGORY_PATH_REDIRECTED_TO_BRAND,
  type LegacyCategory,
  categoryPathFromUrl,
  dbPathFromPath,
  readLegacyCategories,
} from "../categories.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "categoriesCsv"));

describe("path helpers (pure)", () => {
  it("decodes and normalises path", () => {
    expect(categoryPathFromUrl("https://namilux.ir/category/%d8%aa%d9%88%d8%b3%d8%aa%d8%b1-%d8%a7%d8%b3%d9%85%da%af/")).toBe(
      "/category/توستر-اسمگ/",
    );
    expect(categoryPathFromUrl("https://namilux.ir/category/%D8%AA%D9%88%D8%B3%D8%AA%D8%B1-%D8%A7%D8%B3%D9%85%DA%AF")).toBe(
      "/category/توستر-اسمگ/",
    );
  });

  it("dbPath strips prefix and trailing slash", () => {
    expect(dbPathFromPath("/category/توستر-اسمگ/توستر-کوچک-اسمگ/")).toBe("توستر-اسمگ/توستر-کوچک-اسمگ");
    expect(dbPathFromPath("/category/a/")).toBe("a");
    expect(dbPathFromPath("/a/b/")).toBe("a/b");
  });
});

describe.skipIf(!hasExtract)("real categories.csv", () => {
  let categories: LegacyCategory[];
  let collisions: { path: string; kept: number; dropped: number }[];
  let warnings: string[];
  let byId: Map<number, LegacyCategory>;

  beforeAll(async () => {
    const res = await readLegacyCategories(dir);
    categories = res.categories;
    collisions = res.collisions;
    warnings = res.warnings;
    byId = new Map(categories.map((c) => [c.id, c]));
  });

  it("reads all 73 categories and detects no path collision", () => {
    expect(categories).toHaveLength(73);
    expect(collisions).toEqual([]);
    expect(warnings).toEqual([]);
    expect(new Set(categories.map((c) => c.path)).size).toBe(73);
  });

  it("parent 0 → null and 51 roots", () => {
    expect(categories.filter((c) => c.parentId === null)).toHaveLength(51);
    expect(categories.every((c) => c.parentId === null || byId.has(c.parentId))).toBe(true);
    expect(categories.every((c) => c.parentId !== 0)).toBe(true);
  });

  it("orders parents first: 153 نوشیدنی ساز اسمگ before its child 74", () => {
    const parentIndex = categories.findIndex((c) => c.id === 153);
    const childIndex = categories.findIndex((c) => c.id === 74);
    expect(parentIndex).toBeGreaterThanOrEqual(0);
    expect(parentIndex).toBeLessThan(childIndex);
    expect((byId.get(74) as LegacyCategory).parentId).toBe(153);
    // Nesting is depth 2 at most.
    for (const c of categories) {
      const parent = c.parentId === null ? null : byId.get(c.parentId);
      expect(parent?.parentId ?? null).toBeNull();
    }
    for (const c of categories) {
      if (c.parentId === null) continue;
      expect(categories.findIndex((x) => x.id === c.parentId)).toBeLessThan(categories.findIndex((x) => x.id === c.id));
    }
  });

  it("path and dbPath stay byte-for-byte decoded, slugs are never re-encoded", () => {
    for (const c of categories) {
      expect(c.path.startsWith("/category/")).toBe(true);
      expect(c.path.endsWith("/")).toBe(true);
      expect(/%[0-9a-f]{2}/i.test(c.path)).toBe(false);
      expect(/%[0-9a-f]{2}/i.test(c.slug)).toBe(false);
      expect(c.dbPath).toBe(dbPathFromPath(c.path));
      expect(c.dbPath.startsWith("/")).toBe(false);
      expect(c.dbPath.endsWith("/")).toBe(false);
    }
    const child = byId.get(74) as LegacyCategory;
    expect(child.dbPath.split("/")).toHaveLength(2);
  });

  it("Store API rows supply descriptionHtml and covers for 58 of 73", () => {
    expect(categories.filter((c) => c.visibleInStore)).toHaveLength(58);
    expect(categories.filter((c) => c.descriptionHtml !== null).length).toBeGreaterThan(0);
    expect(categories.filter((c) => c.coverUrl !== null).length).toBeGreaterThan(0);
    const wrapped = byId.get(129) as LegacyCategory;
    // The raw HTML keeps its wrapper; the text form is unwrapped.
    expect(wrapped.descriptionHtml?.startsWith("<")).toBe(true);
    expect(wrapped.description.startsWith("<")).toBe(false);
    expect(wrapped.description.length).toBeGreaterThan(20);
  });

  it("the seo_title/seo_description CSV columns are ignored (seo_live.csv is the source)", () => {
    expect(Object.keys(byId.get(129) as LegacyCategory)).not.toContain("seoTitle");
  });

  it("the category the live site 301s to /brand/smeg/ is returned unchanged", () => {
    const smeg = categories.find((c) => c.path === CATEGORY_PATH_REDIRECTED_TO_BRAND);
    expect(smeg).toBeDefined();
    expect(smeg?.productCount).toBeGreaterThan(0);
  });

  it("keeps the empty categories (their URLs are in the 752-URL contract)", () => {
    expect(categories.filter((c) => c.productCount === 0).length).toBeGreaterThan(0);
  });
});
