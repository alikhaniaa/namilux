import { htmlToText, readMinutes } from "@namilux/core/html";
import { faZwnj, truncateWords } from "@namilux/core/persian";
import {
  faqs as faqsTable,
  getTableColumns,
  pages as pagesTable,
  posts as postsTable,
  sql,
  type SQL,
  type Table,
} from "@namilux/db";
import type { SeedContext } from "../context.js";
import { readLegacyPages } from "../extract/pages.js";
import { LEGACY_AUTHOR_NAME, readLegacyPosts } from "../extract/posts.js";
import { readSeoLive, readSitemap, seoFieldsFor } from "../extract/seo.js";
import { syncSequence } from "./catalog.js";
import { collectImageUrls, sanitizeLegacyHtml } from "../transform/sanitize.js";
import { rootPath } from "../transform/slugs.js";
import { inChunks } from "../idempotency.js";
import { warn } from "../report.js";

/** Excerpt budget in words (contract: truncateWords(htmlToText(html), 40)). */
export const EXCERPT_WORDS = 40;

/** Slugs a legacy FAQ page could carry; none exists in the 14 Aug extract (guarded, not assumed). */
export const LEGACY_FAQ_SLUGS: readonly string[] = ["faq", "سوالات-متداول", "پرسش-های-متداول"];

/** The group every FAQ lifted from a legacy page lands in (the spec faqs.group_key). */
export const LEGACY_FAQ_GROUP = "general";

const CHUNK = 200;

function excludedSet<T extends Table>(table: T, keys: readonly string[]): Record<string, SQL> {
  const cols = getTableColumns(table) as unknown as Record<string, { name: string }>;
  const out: Record<string, SQL> = {};
  for (const key of keys) {
    const col = cols[key];
    if (col === undefined) throw new Error(`unknown column ${key}`);
    out[key] = sql.raw(`excluded."${col.name}"`);
  }
  return out;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function excerptFor(html: string): string {
  return truncateWords(htmlToText(html), EXCERPT_WORDS);
}

/**
 * DECISION: the contract signature carries no extract directory, so this cannot itself check the
 * filesystem. It returns the first candidate `<img src>` in document order (normalised by
 * `collectImageUrls`); the media stage - which does have the directory and the media rows - is what
 * resolves it to a `media.id` or drops it (rules: two-pass, idempotent).
 */
export function coverFor(html: string): string | null {
  return collectImageUrls(html)[0] ?? null;
}

/** `<h2>/<h3> question` followed by its answer markup, as a legacy FAQ page is written. */
export function faqsFromHtml(html: string): { question: string; answerHtml: string }[] {
  const out: { question: string; answerHtml: string }[] = [];
  const re = /<h[23][^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23][^>]*>|$)/gi;
  for (const m of html.matchAll(re)) {
    const question = htmlToText(m[1] ?? "").trim();
    const answerHtml = (m[2] ?? "").trim();
    if (!question || !answerHtml) continue;
    out.push({ question: faZwnj(question), answerHtml });
  }
  return out;
}

export async function run(ctx: SeedContext): Promise<void> {
  const [live, sitemap] = await Promise.all([readSeoLive(ctx.extractDir), readSitemap(ctx.extractDir)]);
  const { posts, warnings: postWarnings } = await readLegacyPosts(ctx.extractDir);
  const { pages, warnings: pageWarnings } = await readLegacyPages(ctx.extractDir);
  for (const w of [...postWarnings, ...pageWarnings]) warn(ctx.report, w);

  // Until the media stage has the content images, unresolved `<img>`s are dropped by the sanitizer
  // (the spec: an output src is only ever first-party). The media stage re-runs this pass.
  const resolveImage = (): string | null => null;

  const postRows = posts.map((p) => {
    const sanitized = sanitizeLegacyHtml(p.contentHtml, { resolveImage, siteOrigin: ctx.siteOrigin });
    const fields = seoFieldsFor(rootPath(p.slug), live, sitemap);
    return {
      id: p.id,
      slug: p.slug,
      title: faZwnj(p.title),
      excerpt: faZwnj(p.excerpt.trim() ? p.excerpt : excerptFor(p.contentHtml)),
      bodyHtml: sanitized.html,
      // Linked by the media stage once a local file exists for the first content image.
      coverMediaId: null,
      authorName: LEGACY_AUTHOR_NAME,
      tags: [],
      status: "published" as const,
      publishedAt: toDate(p.publishedAt),
      legacyLastmod: toDate(fields.legacyLastmod),
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
      robots: fields.robots,
      readMinutes: readMinutes(sanitized.html),
      relatedProductIds: null,
    };
  });

  const pageRows = pages.map((p) => {
    const sanitized = sanitizeLegacyHtml(p.contentHtml, { resolveImage, siteOrigin: ctx.siteOrigin });
    const fields = seoFieldsFor(rootPath(p.slug), live, sitemap);
    return {
      id: p.id,
      slug: p.slug,
      title: faZwnj(p.title),
      bodyHtml: sanitized.html,
      template: p.template,
      // Policy decides: the 4 content/legal pages publish, the 11 route/system pages stay archived
      // (their URLs are served by routes or by the redirects stage).
      status: p.publish ? "published" : "archived",
      seoTitle: fields.seoTitle,
      // The crawl's description is the legacy body's first 160 characters, so a page whose body the
      // policy replaced would otherwise keep a summary of prose that no longer exists.
      seoDescription: p.seoDescription ?? fields.seoDescription,
      robots: fields.robots,
      legacyLastmod: toDate(fields.legacyLastmod),
    };
  });

  const faqRows = (() => {
    const source = pages.find((p) => LEGACY_FAQ_SLUGS.includes(p.slug));
    if (!source) return [];
    return faqsFromHtml(source.contentHtml).map((f, i) => ({
      groupKey: LEGACY_FAQ_GROUP,
      question: f.question,
      answerHtml: sanitizeLegacyHtml(f.answerHtml, { resolveImage, siteOrigin: ctx.siteOrigin }).html,
      sort: i + 1,
      isActive: true,
    }));
  })();

  if (!ctx.dry) {
    const postSet = excludedSet(postsTable, [
      "slug",
      "title",
      "excerpt",
      "bodyHtml",
      "authorName",
      "tags",
      "status",
      "publishedAt",
      "legacyLastmod",
      "seoTitle",
      "seoDescription",
      "robots",
      "readMinutes",
    ]);
    await inChunks(postRows, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(postsTable).values(chunk as never).onConflictDoUpdate({ target: postsTable.id, set: postSet });
      });
    });

    const pageSet = excludedSet(pagesTable, [
      "slug",
      "title",
      "bodyHtml",
      "template",
      "status",
      "seoTitle",
      "seoDescription",
      "robots",
      "legacyLastmod",
    ]);
    await inChunks(pageRows, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(pagesTable).values(chunk as never).onConflictDoUpdate({ target: pagesTable.id, set: pageSet });
      });
    });

    // Legacy ids are verbatim, so both sequences move past them.
    await syncSequence(ctx, "posts");
    await syncSequence(ctx, "pages");

    if (faqRows.length > 0) {
      const existing = await ctx.db.select({ id: faqsTable.id }).from(faqsTable).limit(1);
      // faqs has no natural key; the seed inserts them once and never touches admin edits after that.
      if (existing.length === 0) {
        await ctx.db.transaction(async (tx) => {
          await tx.insert(faqsTable).values(faqRows);
        });
      }
    }
  }

  ctx.report.posts = postRows.length;
  ctx.report.pages = pageRows.length;
  ctx.report.pagesPublished = pageRows.filter((p) => p.status === "published").length;
  ctx.report.pagesArchived = pageRows.filter((p) => p.status === "archived").length;
  if (faqRows.length === 0) {
    ctx.log.info("no legacy FAQ page in the extract — the admin authors the faqs (F-071)");
  }

  ctx.log.info(
    { posts: ctx.report.posts, pages: ctx.report.pages, faqs: faqRows.length },
    "content stage done",
  );
}
