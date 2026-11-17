import { and, count, desc, eq, ilike, isNotNull, isNull, lte, max, media, or, posts as postsTable, sql } from "@namilux/db";
import type { Db, SQL } from "@namilux/db";
import type { Actor, ImageRef, SeoFields } from "../types";
import type { Paged } from "../catalog/list";
import { appError, isAppError } from "../errors";
import { audit } from "../audit";
import { faNorm, faZwnj } from "../persian";
import { htmlToText, readMinutes, sanitizeHtml } from "../html";
import { absUrl, decPath, mediaUrl, postUrl } from "../url";
import { toImageRef } from "../catalog/media";
import { tagsForPostChange } from "../cache/invalidation";
import { redirectTargetForPost } from "../catalog/archive";
import { lastmodFor } from "../seo/sitemaps";
import { insertRedirect } from "./redirects";

export const POSTS_PAGE_SIZE = 12;

export type PostStatus = "draft" | "published" | "archived";

// DECISION (M0 step 3): PostCard / PostView / PostInput are declared once in ../types
// (the spec §content · getPostBySlug, listPosts).
import type { PostCard, PostInput, PostView } from "../types";

export type { PostCard, PostView, PostInput };

/**
 * DECISION - the header's inline `PostCard`/`PostView` field lists are superseded by ../types
 * (src/index.ts rules: "types/* wins; a module may only re-export a type it imports from ../types";
 * a second declaration is a TS2308 build break). Every field ../types drops is still reachable, and
 * deliberately so:
 *   • `href`            → `postUrl(slug)` (../url, client-safe) - one encoder, one contract.
 *   • `robots`          → `seo.robots`; `legacyLastmod` → `seo.lastmod` (SeoFields already carries both).
 *   • `dateModified`    → `dateModifiedFor(...)`, exported below and used to fill `seo.lastmod`.
 *   • `crumbs`          → «خانه»/«ژورنال» are Persian UI copy, and the spec puts UI copy in
 *                          apps/web/src/i18n/fa.ts, never in core.
 *   • `jsonld`          → `jsonld.post(view, { path }, ctx)` (seo/jsonld.ts, DONE). Its real signature
 *                          needs a `JsonLdCtx` (siteName + store settings + mediaUrl) that this
 *                          function's `ctx` cannot supply, so the caller composes it.
 *   • `relatedProducts` → `relatedProductIds` + `getProductCards` (catalog/products.service). Keeping
 *                          the ids here also keeps the whole READ path free of then-unbuilt modules.
 *
 */
export type PostAdminRow = {
  id: number;
  slug: string;
  title: string;
  status: PostStatus;
  publishedAt: string | null;
  updatedAt: string;
  authorName: string;
  readMinutes: number;
};

/**
 * DECISION: the admin list is not the journal index - 12 rows would make moderating 150 posts a
 * chore. 50 mirrors `content/redirects.REDIRECTS_PAGE_SIZE`, the only other admin list in core.
 */
export const POSTS_ADMIN_PAGE_SIZE = 50;

/** rules: «excerpt null → htmlToText(bodyHtml, 40 words)» - the same budget the seed importer uses. */
const EXCERPT_WORDS = 40;

/** validation/content.postSchema caps tags at 20 and each tag at 40 chars. */
const TAGS_MAX = 20;
const TAG_MAX_CHARS = 40;

/**
 * rules: «seo.title = seo_title ?? `${title} - نامی لوکس`» - the row-level fallback, identical to
 * catalog/categories, catalog/brands and catalog/products.service. The admin-editable
 * `settings["seo.defaults"].titleTemplate` is applied one layer up, by seo/metadata.buildMetadata.
 */
const TITLE_SUFFIX = " - نامی لوکس";

/**
 * DECISION: `dateModifiedFor`'s signature carries no `launchAt`, and seo/sitemaps.ts keeps its own
 * `LAUNCH_AT` private, so the cutover instant is repeated here. It is the same fixed instant, never
 * `Date.now()`: before cutover every seeded row keeps its legacy date, after cutover only rows a
 * human actually edited move (the spec "never the build date").
 */
const LAUNCH_AT = "2026-09-01T00:00:00.000Z";

// ---------------------------------------------------------------- pure helpers

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/**
 * A root slug is stored DECODED. Requests arrive either way, so an encoded slug is decoded
 * and the surrounding slashes/whitespace are stripped before it becomes a WHERE parameter.
 */
function slugKey(raw: string): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return "";
  return decPath(trimmed).normalize("NFC");
}

export function dateModifiedFor(p: {
  legacyLastmod: string | null;
  updatedAt: string;
  publishedAt: string;
}): string {
  const base = lastmodFor({
    legacyLastmod: p.legacyLastmod,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    launchAt: LAUNCH_AT,
  });
  if (p.legacyLastmod !== null) return base;
  // EDGE CASE: «no legacy → publishedAt or updatedAt whichever is later». lastmodFor prefers
  // published_at for a never-edited row; a post with no legacy URL has no ranking history to
  // preserve, so the newer of the two is the honest answer.
  const published = Date.parse(p.publishedAt);
  const updated = Date.parse(p.updatedAt);
  if (Number.isNaN(published) || Number.isNaN(updated)) return base;
  return new Date(Math.max(published, updated)).toISOString();
}

/** rules: «tags faNorm-deduped» - first spelling wins, empties dropped, capped at the schema max. */
function normalizeTags(raw: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const tag = faZwnj(candidate.trim()).slice(0, TAG_MAX_CHARS);
    if (tag === "") continue;
    const key = faNorm(tag);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === TAGS_MAX) break;
  }
  return out;
}

/**
 * rules: public reads are «status=published AND publishedAt ≤ now».
 * DECISION: a NULL published_at counts as live, not scheduled - identical to
 * content/redirects.resolveRootSlug and tests/contract/check-contract.ts, so the 752-URL contract
 * cannot disagree with the page that serves it.
 */
function publiclyVisible(now: Date): SQL {
  const predicate = and(
    eq(postsTable.status, "published"),
    or(isNull(postsTable.publishedAt), lte(postsTable.publishedAt, now)),
  );
  // `and` is only undefined for an empty argument list.
  return predicate ?? sql`true`;
}

// ---------------------------------------------------------------- row → view

/** Only the columns of the media row `toImageRef` reads. */
type CoverRow = {
  id: string;
  kind: "image" | "video" | "file";
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string;
  lqip: string | null;
  renditionsJson: unknown;
  normalizeJson: unknown;
};

const coverColumns = {
  id: media.id,
  kind: media.kind,
  storageKey: media.storageKey,
  mime: media.mime,
  width: media.width,
  height: media.height,
  durationMs: media.durationMs,
  alt: media.alt,
  lqip: media.lqip,
  renditionsJson: media.renditionsJson,
  normalizeJson: media.normalizeJson,
} as const;

function coverRefOf(row: { cover: CoverRow | null }, altFallback: string): ImageRef | null {
  const cover = row.cover;
  // A LEFT JOIN with no match yields a group of NULLs; drizzle collapses it to null, but the id is
  // re-checked so a partially-null group can never be handed to toImageRef.
  if (cover === null || cover === undefined) return null;
  if (typeof cover.id !== "string" || cover.id === "") return null;
  return toImageRef(
    {
      id: cover.id,
      kind: cover.kind,
      storageKey: cover.storageKey,
      mime: cover.mime,
      width: cover.width,
      height: cover.height,
      durationMs: cover.durationMs,
      alt: cover.alt,
      lqip: cover.lqip,
      renditionsJson: cover.renditionsJson as never,
      normalizeJson: cover.normalizeJson as never,
    },
    { altFallback },
  );
}

const cardColumns = {
  id: postsTable.id,
  slug: postsTable.slug,
  title: postsTable.title,
  excerpt: postsTable.excerpt,
  tags: postsTable.tags,
  readMinutes: postsTable.readMinutes,
  publishedAt: postsTable.publishedAt,
  createdAt: postsTable.createdAt,
} as const;

type CardRow = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  tags: string[];
  readMinutes: number;
  publishedAt: Date | null;
  createdAt: Date;
  cover: CoverRow | null;
};

/**
 * DECISION: `PostCard.publishedAt` is non-nullable, and a published row may still carry a NULL
 * published_at (see `publiclyVisible`); `created_at` - always present - is the fallback rather than
 * an invented "now", which would move on every request and poison the JSON-LD date.
 */
function toPostCard(row: CardRow): PostCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? "",
    cover: coverRefOf(row, row.title),
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    readMinutes: row.readMinutes,
    tags: row.tags,
  };
}

// ---------------------------------------------------------------- read

export async function getPostBySlug(
  db: Db,
  slug: string,
  ctx?: { origin?: string; now?: Date },
): Promise<PostView | null> {
  const key = slugKey(slug);
  if (key === "") return null;
  const now = ctx?.now ?? new Date();

  const rows = await db
    .select({
      ...cardColumns,
      bodyHtml: postsTable.bodyHtml,
      authorName: postsTable.authorName,
      status: postsTable.status,
      legacyLastmod: postsTable.legacyLastmod,
      seoTitle: postsTable.seoTitle,
      seoDescription: postsTable.seoDescription,
      robots: postsTable.robots,
      relatedProductIds: postsTable.relatedProductIds,
      updatedAt: postsTable.updatedAt,
      cover: coverColumns,
    })
    .from(postsTable)
    .leftJoin(media, eq(media.id, postsTable.coverMediaId))
    .where(and(eq(postsTable.slug, key), publiclyVisible(now)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const card = toPostCard(row);
  // rules: «excerpt null → htmlToText(bodyHtml, 40 words)» is a write-time rule; a legacy row that
  // slipped through without one still gets a usable excerpt here rather than an empty card.
  const excerpt = card.excerpt === "" ? htmlToText(row.bodyHtml, EXCERPT_WORDS) : card.excerpt;
  const path = postUrl(row.slug);
  const origin = ctx?.origin;
  const seoTitle = (row.seoTitle ?? "").trim();
  const seoDescription = (row.seoDescription ?? "").trim();

  const seo: SeoFields = {
    title: seoTitle === "" ? `${row.title}${TITLE_SUFFIX}` : seoTitle,
    // rules: «description verbatim ?? excerpt» - never auto-written, the 86 missing legacy
    // descriptions stay missing until Phase 2.
    description: seoDescription === "" ? (excerpt === "" ? null : excerpt) : seoDescription,
    robots: row.robots,
    // DECISION: `canonical` (../types SeoFields) is the header's `canonicalPath` - site-relative and
    // already encoded - and becomes absolute only when a caller supplies its origin. Both forms go
    // through ../url, which is the actual contract.
    canonical: origin === undefined || origin === "" ? path : absUrl(origin, path),
    // DECISION: seo/og.ts exports neither `ogImagePath` nor `SITE_OG_PATH` (it has ogKeyFor /
    // ensureOg / ogUrl, all unbuilt at the time). The cover is the truthful per-post OG source; the site
    // fallback belongs to seo/metadata.buildMetadata, which already takes a `defaultOgKey`.
    ogImage: card.cover === null ? null : mediaUrl(card.cover.key),
    lastmod: dateModifiedFor({
      legacyLastmod: iso(row.legacyLastmod),
      updatedAt: row.updatedAt.toISOString(),
      publishedAt: card.publishedAt,
    }),
  };

  return {
    ...card,
    excerpt,
    bodyHtml: row.bodyHtml,
    authorName: row.authorName ?? "",
    status: row.status,
    relatedProductIds: row.relatedProductIds ?? [],
    seo,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** EDGE CASE: «listPosts(page 0) → page 1». Non-finite input degrades to page 1 as well. */
function clampPage(page: number): number {
  if (typeof page !== "number" || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.trunc(page));
}

export async function listPosts(db: Db, page: number): Promise<Paged<PostCard>> {
  const now = new Date();
  const wanted = clampPage(page);
  const visible = publiclyVisible(now);

  const totals = await db.select({ value: count() }).from(postsTable).where(visible);
  const total = totals[0]?.value ?? 0;

  const rows = await db
    .select({ ...cardColumns, cover: coverColumns })
    .from(postsTable)
    .leftJoin(media, eq(media.id, postsTable.coverMediaId))
    .where(visible)
    // NULLS LAST keeps a dateless legacy row at the end instead of at the top of the journal.
    .orderBy(sql`${postsTable.publishedAt} desc nulls last`, desc(postsTable.id))
    .limit(POSTS_PAGE_SIZE)
    .offset((wanted - 1) * POSTS_PAGE_SIZE);

  return { items: rows.map(toPostCard), total, page: wanted, pageSize: POSTS_PAGE_SIZE };
}

export async function listRecentPosts(db: Db, n: number): Promise<PostCard[]> {
  if (typeof n !== "number" || !Number.isFinite(n)) return [];
  // A rail is a rail: an unbounded `n` from a caller must not turn into a full-table scan.
  const take = Math.min(POSTS_ADMIN_PAGE_SIZE, Math.trunc(n));
  if (take < 1) return [];

  const rows = await db
    .select({ ...cardColumns, cover: coverColumns })
    .from(postsTable)
    .leftJoin(media, eq(media.id, postsTable.coverMediaId))
    .where(publiclyVisible(new Date()))
    .orderBy(sql`${postsTable.publishedAt} desc nulls last`, desc(postsTable.id))
    .limit(take);

  return rows.map(toPostCard);
}

export async function listPostsForSitemap(
  db: Db,
): Promise<
  { slug: string; legacyLastmod: string | null; updatedAt: string; publishedAt: string; robots: string }[]
> {
  const rows = await db
    .select({
      slug: postsTable.slug,
      legacyLastmod: postsTable.legacyLastmod,
      updatedAt: postsTable.updatedAt,
      publishedAt: postsTable.publishedAt,
      createdAt: postsTable.createdAt,
      robots: postsTable.robots,
    })
    .from(postsTable)
    .where(publiclyVisible(new Date()))
    .orderBy(sql`${postsTable.publishedAt} desc nulls last`, desc(postsTable.id));

  return rows.map((row) => ({
    slug: row.slug,
    legacyLastmod: iso(row.legacyLastmod),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    robots: row.robots,
  }));
}

// ---------------------------------------------------------------- admin

/**
 * rules: «legacy slugs immutable (CONFLICT on change for ids ≤ max legacy id)».
 * DECISION: the ceiling is derived, never a magic number - a legacy post is exactly a post the seed
 * gave a `legacy_lastmod` (the spec sitemap dates), so `max(id) where legacy_lastmod is not null` IS
 * "the max legacy id" and it cannot drift when the catalogue is re-seeded.
 */
async function maxLegacyPostId(db: Db): Promise<number> {
  const rows = await db
    .select({ value: max(postsTable.id) })
    .from(postsTable)
    .where(isNotNull(postsTable.legacyLastmod));
  return rows[0]?.value ?? 0;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function upsertPost(
  db: Db,
  input: PostInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const slug = slugKey(input.slug);
  if (slug === "") throw appError("VALIDATION", { details: { field: "slug", reason: "required" } });

  const title = faZwnj((input.title ?? "").trim());
  if (title === "") throw appError("VALIDATION", { details: { field: "title", reason: "required" } });

  // the spec: the body is sanitized at WRITE time; RichHtml sanitizes again at render.
  const bodyHtml = sanitizeHtml(input.bodyHtml ?? "", { allowImages: true });
  const givenExcerpt = (input.excerpt ?? "").trim();
  const excerpt = faZwnj(givenExcerpt === "" ? htmlToText(bodyHtml, EXCERPT_WORDS) : givenExcerpt);
  const tags = normalizeTags(input.tags);
  const status = input.status;
  const authorName = faZwnj((input.authorName ?? "").trim());
  const givenPublishedAt = parseInstant(input.publishedAt);

  const existing =
    input.id === undefined
      ? undefined
      : (
          await db
            .select({
              id: postsTable.id,
              slug: postsTable.slug,
              title: postsTable.title,
              status: postsTable.status,
              publishedAt: postsTable.publishedAt,
            })
            .from(postsTable)
            .where(eq(postsTable.id, input.id))
            .limit(1)
        )[0];

  if (input.id !== undefined && existing === undefined) {
    throw appError("NOT_FOUND", { details: { entity: "post", id: input.id } });
  }

  // DECISION: publishing without an explicit date stamps `now` once; a post that is already
  // published keeps the date it was published on, so re-saving never rewrites its BlogPosting date.
  const publishedAt =
    givenPublishedAt ?? (status === "published" ? (existing?.publishedAt ?? new Date()) : null);

  const values = {
    slug,
    title,
    excerpt,
    bodyHtml,
    coverMediaId: input.coverMediaId ?? null,
    authorName: authorName === "" ? null : authorName,
    tags,
    status,
    publishedAt,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    robots: input.robots ?? "index, follow",
    readMinutes: readMinutes(bodyHtml),
    relatedProductIds: input.relatedProductIds ?? [],
  };

  if (existing === undefined) {
    const inserted = await db.insert(postsTable).values(values).returning({ id: postsTable.id });
    const row = inserted[0];
    if (row === undefined) throw appError("INTERNAL", { details: { reason: "post_insert_failed" } });
    await audit.log(db, actor, "post.create", "post", String(row.id), undefined, values);
    return { id: row.id, tags: tagsForPostChange(slug) };
  }

  const slugChanged = existing.slug !== slug;
  if (slugChanged && existing.id <= (await maxLegacyPostId(db))) {
    // EDGE CASE: a legacy slug is a ranking asset - it is never renamed, only archived.
    throw appError("CONFLICT", {
      details: { field: "slug", reason: "legacy_slug_immutable", id: existing.id },
    });
  }

  await db
    .update(postsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(postsTable.id, existing.id));
  await audit.log(db, actor, "post.update", "post", String(existing.id), existing, values);

  const changed = tagsForPostChange(slug);
  if (slugChanged) {
    // The old path stops serving 200 the moment the row above committed, so a `manual` row is now
    // legal (redirects.prepareRedirect refuses manual rows on live paths).
    await insertRedirect(
      db,
      { fromPath: `/${existing.slug}/`, toPath: `/${slug}/`, code: 301, source: "manual" },
      actor,
    );
    changed.push(...tagsForPostChange(existing.slug));
  }
  return { id: existing.id, tags: [...new Set(changed)].sort() };
}

export async function archivePost(db: Db, id: number, actor: Actor): Promise<void> {
  const rows = await db
    .select({ id: postsTable.id, slug: postsTable.slug, status: postsTable.status })
    .from(postsTable)
    .where(eq(postsTable.id, id))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw appError("NOT_FOUND", { details: { entity: "post", id } });
  // EDGE CASE: archiving twice writes one redirect row and one audit entry.
  if (row.status === "archived") return;

  await db
    .update(postsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(postsTable.id, id));

  const toPath = redirectTargetForPost();
  try {
    await insertRedirect(
      db,
      { fromPath: `/${row.slug}/`, toPath, code: 301, source: "auto_archive" },
      actor,
    );
  } catch (err: unknown) {
    // catalog/archive rules: an existing row for the same from_path is a manual decision and wins.
    if (!isAppError(err) || err.code !== "CONFLICT") throw err;
  }

  await audit.log(db, actor, "post.archive", "post", String(id), { status: row.status }, {
    status: "archived",
    redirectTo: toPath,
  });
  // DECISION: the contract returns void, so the tag list cannot be handed back; the admin route
  // revalidates with `tagsForPostChange(slug)` (+ the URL purge of cache/urls.ts), exactly as the
  // upsert path does.
}

export async function listPostsAdmin(
  db: Db,
  q: { status?: PostStatus; search?: string; page: number },
): Promise<Paged<PostAdminRow>> {
  const page = clampPage(q.page);
  const terms: SQL[] = [];
  if (q.status !== undefined) terms.push(eq(postsTable.status, q.status));

  const search = faNorm(typeof q.search === "string" ? q.search : "");
  if (search !== "") {
    // posts.search_text is `nl_fa_norm(title, excerpt, tags)`; faNorm is its TypeScript twin, so the
    // needle and the haystack are normalised the same way. `%`/`_` are escaped, never concatenated.
    const needle = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    terms.push(ilike(postsTable.searchText, needle));
  }
  const where = terms.length === 0 ? undefined : (and(...terms) ?? undefined);

  const totals = await db.select({ value: count() }).from(postsTable).where(where);
  const total = totals[0]?.value ?? 0;

  const rows = await db
    .select({
      id: postsTable.id,
      slug: postsTable.slug,
      title: postsTable.title,
      status: postsTable.status,
      publishedAt: postsTable.publishedAt,
      updatedAt: postsTable.updatedAt,
      authorName: postsTable.authorName,
      readMinutes: postsTable.readMinutes,
    })
    .from(postsTable)
    .where(where)
    .orderBy(desc(postsTable.updatedAt), desc(postsTable.id))
    .limit(POSTS_ADMIN_PAGE_SIZE)
    .offset((page - 1) * POSTS_ADMIN_PAGE_SIZE);

  return {
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      publishedAt: iso(row.publishedAt),
      updatedAt: row.updatedAt.toISOString(),
      authorName: row.authorName ?? "",
      readMinutes: row.readMinutes,
    })),
    total,
    page,
    pageSize: POSTS_ADMIN_PAGE_SIZE,
  };
}
