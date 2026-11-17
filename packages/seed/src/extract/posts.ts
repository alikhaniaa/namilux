import { readFile } from "node:fs/promises";
import { extractPath } from "./paths.js";
import { decodeSlug, rootPath } from "../transform/slugs.js";
import { excerptFrom } from "../transform/zwnj.js";
import { stripTags } from "../transform/sanitize.js";

export type LegacyPost = {
  id: number;
  slug: string;
  path: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  publishedAt: string;
  modifiedAt: string;
  featuredMediaId: number | null;
  tagIds: number[];
  categoryIds: number[];
  authorId: number;
  status: "publish";
};

export const LEGACY_AUTHOR_NAME = "نامی لوکس";

/** Excerpt budget (the spec posts.excerpt). */
export const EXCERPT_MAX_CHARS = 240;

const OFFSET_RE = /(?:Z|z|[+-]\d{2}:?\d{2})$/;

export function isoFromWpGmt(s: string | undefined | null): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  // WP REST `*_gmt` fields are UTC but carry no designator; everything else is passed through.
  return OFFSET_RE.test(t) ? t.replace(/z$/, "Z") : `${t}Z`;
}

type RawWpPost = {
  id?: unknown;
  slug?: unknown;
  status?: unknown;
  date?: unknown;
  date_gmt?: unknown;
  modified?: unknown;
  modified_gmt?: unknown;
  title?: { rendered?: unknown } | null;
  content?: { rendered?: unknown } | null;
  excerpt?: { rendered?: unknown } | null;
  author?: unknown;
  featured_media?: unknown;
  categories?: unknown;
  tags?: unknown;
};

function rendered(v: { rendered?: unknown } | null | undefined): string {
  return typeof v?.rendered === "string" ? v.rendered : "";
}

function numberList(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
}

export async function readLegacyPosts(dir: string): Promise<{ posts: LegacyPost[]; warnings: string[] }> {
  const parsed: unknown = JSON.parse(await readFile(extractPath(dir, "postsJson"), "utf8"));
  const raw = (parsed as { posts?: unknown } | null)?.posts;
  const warnings: string[] = [];
  const posts: LegacyPost[] = [];
  if (!Array.isArray(raw)) return { posts, warnings: ["posts.json has no `posts` array"] };

  const seen = new Set<string>();
  for (const p of raw as RawWpPost[]) {
    if (!p || typeof p !== "object") continue;
    const id = Number(p.id);
    if (!Number.isFinite(id)) {
      warnings.push("post without a numeric id skipped");
      continue;
    }
    if (p.status !== "publish") {
      warnings.push(`post ${id} has status "${String(p.status)}" — skipped`);
      continue;
    }
    const slug = decodeSlug(typeof p.slug === "string" ? p.slug : "");
    if (!slug) {
      warnings.push(`post ${id} has no slug — skipped`);
      continue;
    }
    if (seen.has(slug)) throw new Error(`duplicate post slug: ${slug}`);
    seen.add(slug);

    const contentHtml = rendered(p.content);
    const excerptHtml = rendered(p.excerpt);
    const featured = Number(p.featured_media);

    posts.push({
      id,
      slug,
      // Posts live at the root and share the namespace with pages.
      path: rootPath(slug),
      title: stripTags(rendered(p.title)),
      excerpt: excerptFrom(excerptHtml.trim() ? excerptHtml : contentHtml, EXCERPT_MAX_CHARS),
      contentHtml,
      // Legacy dates, never "now".
      publishedAt: isoFromWpGmt(typeof p.date_gmt === "string" ? p.date_gmt : null) ?? isoFromWpGmt(typeof p.date === "string" ? p.date : null) ?? "",
      modifiedAt:
        isoFromWpGmt(typeof p.modified_gmt === "string" ? p.modified_gmt : null) ??
        isoFromWpGmt(typeof p.modified === "string" ? p.modified : null) ??
        "",
      featuredMediaId: Number.isFinite(featured) && featured > 0 ? featured : null,
      tagIds: numberList(p.tags),
      categoryIds: numberList(p.categories),
      authorId: Number(p.author) || 0,
      status: "publish",
    });
  }

  posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { posts, warnings };
}
