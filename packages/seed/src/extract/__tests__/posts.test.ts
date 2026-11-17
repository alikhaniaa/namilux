import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import { EXCERPT_MAX_CHARS, LEGACY_AUTHOR_NAME, type LegacyPost, isoFromWpGmt, readLegacyPosts } from "../posts.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "postsJson"));

describe("isoFromWpGmt (pure)", () => {
  it("gmt → iso Z", () => {
    expect(isoFromWpGmt("2026-06-19T15:50:02")).toBe("2026-06-19T15:50:02Z");
    expect(isoFromWpGmt("2026-06-19T15:50:02Z")).toBe("2026-06-19T15:50:02Z");
    expect(isoFromWpGmt("2026-06-19T15:50:02+00:00")).toBe("2026-06-19T15:50:02+00:00");
    expect(isoFromWpGmt("")).toBeNull();
    expect(isoFromWpGmt(null)).toBeNull();
    expect(isoFromWpGmt(undefined)).toBeNull();
  });

  it("the brand is the author name (WP author 24240 has no public name)", () => {
    expect(LEGACY_AUTHOR_NAME).toBe("نامی لوکس");
  });
});

describe.skipIf(!hasExtract)("real posts.json", () => {
  let posts: LegacyPost[];
  let warnings: string[];

  beforeAll(async () => {
    const res = await readLegacyPosts(dir);
    posts = res.posts;
    warnings = res.warnings;
  });

  it("reads all 150 published posts with no warnings", () => {
    expect(posts).toHaveLength(150);
    expect(warnings).toEqual([]);
    expect(posts.every((p) => p.status === "publish")).toBe(true);
    expect(new Set(posts.map((p) => p.slug)).size).toBe(150);
    expect(new Set(posts.map((p) => p.id)).size).toBe(150);
  });

  it("decodes slug and builds root path", () => {
    for (const p of posts) {
      expect(/%[0-9a-f]{2}/i.test(p.slug)).toBe(false);
      expect(p.path).toBe(`/${p.slug}/`);
      expect(p.path.startsWith("/")).toBe(true);
    }
  });

  it("gmt → iso Z on every post and sorted by publishedAt desc", () => {
    for (const p of posts) {
      expect(p.publishedAt.endsWith("Z")).toBe(true);
      expect(p.modifiedAt.endsWith("Z")).toBe(true);
      expect(Number.isNaN(Date.parse(p.publishedAt))).toBe(false);
    }
    const dates = posts.map((p) => p.publishedAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
    // Real legacy dates, never "now".
    expect(new Date(dates[0] as string).getFullYear()).toBeLessThanOrEqual(2026);
  });

  it("featured 0 → null", () => {
    expect(posts.filter((p) => p.featuredMediaId === null)).toHaveLength(1);
    expect(posts.every((p) => p.featuredMediaId === null || p.featuredMediaId > 0)).toBe(true);
  });

  it("entities decoded in title and no HTML survives", () => {
    for (const p of posts) {
      expect(p.title.includes("<")).toBe(false);
      expect(p.title).not.toMatch(/&#\d+;|&amp;|&nbsp;/);
      expect(p.title.length).toBeGreaterThan(0);
    }
  });

  it("excerpt fallback from content and the 240-char budget", () => {
    for (const p of posts) {
      expect(p.excerpt.length).toBeGreaterThan(0);
      expect(p.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS + 1);
      expect(p.excerpt.includes("<")).toBe(false);
    }
  });

  it("keeps the raw content HTML for transform/sanitize.ts", () => {
    const withHtml = posts.filter((p) => p.contentHtml.includes("<"));
    expect(withHtml.length).toBe(150);
    expect(posts.every((p) => Array.isArray(p.categoryIds) && Array.isArray(p.tagIds))).toBe(true);
    expect(posts.every((p) => Number.isInteger(p.authorId))).toBe(true);
  });
});
