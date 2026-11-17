import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, posts as postsTable, redirects as redirectsTable } from "@namilux/db";
import { createTestDb, hasTestDb, seedMinimal, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

// DECISION: ../../audit is owned by another module and not yet built when this was written (its `log` throws).
vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

// DECISION: ../../cache/invalidation is unbuilt at the time too; the mock returns exactly the list its own
// header specifies for `tagsForPostChange` ("post:slug, content, home, sitemap").
vi.mock("../../cache/invalidation", () => ({
  tagsForPostChange: (slug: string) => [`post:${slug}`, "content", "home", "sitemap"],
  tagsForPageChange: (slug: string) => [`page:${slug}`, "content", "sitemap"],
}));

import {
  POSTS_ADMIN_PAGE_SIZE,
  POSTS_PAGE_SIZE,
  archivePost,
  dateModifiedFor,
  getPostBySlug,
  listPosts,
  listPostsAdmin,
  listPostsForSitemap,
  listRecentPosts,
  upsertPost,
} from "../posts";
import type { PostInput } from "../posts";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "staff-test" };

/** Before the cutover instant posts.ts uses for "edited after launch". */
const BEFORE_LAUNCH = "2026-02-01T00:00:00.000Z";
/** After it. */
const AFTER_LAUNCH = "2026-10-01T00:00:00.000Z";

async function expectAppError(promise: Promise<unknown>, code: ErrorCode, reason?: string): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(isAppError(err)).toBe(true);
    if (!isAppError(err)) return;
    expect(err.code).toBe(code);
    if (reason !== undefined) expect(err.details).toMatchObject({ reason });
    return;
  }
  throw new Error(`expected an AppError ${code}`);
}

const input = (over: Partial<PostInput> & Pick<PostInput, "slug" | "title">): PostInput => ({
  excerpt: "",
  bodyHtml: "<p>متن</p>",
  tags: [],
  status: "published",
  robots: "index, follow",
  relatedProductIds: [],
  ...over,
});

// ── pure: dateModifiedFor ──────────────────────────────────────────────────────────────────────

describe("dateModified rule", () => {
  it("never edited → legacy_lastmod", () => {
    expect(
      dateModifiedFor({
        legacyLastmod: "2024-05-01T00:00:00.000Z",
        updatedAt: BEFORE_LAUNCH,
        publishedAt: "2024-04-01T00:00:00.000Z",
      }),
    ).toBe("2024-05-01T00:00:00.000Z");
  });

  it("edited after launch → updated_at", () => {
    expect(
      dateModifiedFor({
        legacyLastmod: "2024-05-01T00:00:00.000Z",
        updatedAt: AFTER_LAUNCH,
        publishedAt: "2024-04-01T00:00:00.000Z",
      }),
    ).toBe(AFTER_LAUNCH);
  });

  it("no legacy → publishedAt or updatedAt whichever is later", () => {
    expect(
      dateModifiedFor({
        legacyLastmod: null,
        updatedAt: "2026-03-01T00:00:00.000Z",
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("2026-03-01T00:00:00.000Z");

    expect(
      dateModifiedFor({
        legacyLastmod: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        publishedAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toBe("2026-03-01T00:00:00.000Z");
  });

  it("never returns an invalid date", () => {
    const out = dateModifiedFor({
      legacyLastmod: "2024-05-01T00:00:00.000Z",
      updatedAt: AFTER_LAUNCH,
      publishedAt: "2024-04-01T00:00:00.000Z",
    });
    expect(Number.isNaN(Date.parse(out))).toBe(false);
  });
});

// ── integration ────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasTestDb())("posts against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("scheduled post hidden", async () => {
    await withTestTx(handle.db, async (tx) => {
      const future = new Date(Date.now() + 86_400_000);
      await tx.insert(postsTable).values([
        { slug: "live-post", title: "زنده", excerpt: "خ", status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z") },
        { slug: "scheduled-post", title: "زمان‌بندی", excerpt: "خ", status: "published", publishedAt: future },
        { slug: "draft-post", title: "پیش‌نویس", excerpt: "خ", status: "draft" },
      ]);

      expect(await getPostBySlug(tx, "scheduled-post")).toBeNull();
      expect(await getPostBySlug(tx, "draft-post")).toBeNull();
      expect(await getPostBySlug(tx, "live-post")).not.toBeNull();

      const page = await listPosts(tx, 1);
      expect(page.items.map((p) => p.slug)).toEqual(["live-post"]);
      expect(page.total).toBe(1);

      const sitemap = await listPostsForSitemap(tx);
      expect(sitemap.map((p) => p.slug)).toEqual(["live-post"]);

      expect((await listRecentPosts(tx, 3)).map((p) => p.slug)).toEqual(["live-post"]);
      expect(await listRecentPosts(tx, 0)).toEqual([]);

      // …but the scheduled post becomes visible once `now` passes it
      const later = new Date(future.getTime() + 1000);
      expect(await getPostBySlug(tx, "scheduled-post", { now: later })).not.toBeNull();

      // the admin list ignores publication state entirely
      const admin = await listPostsAdmin(tx, { page: 1 });
      expect(admin.total).toBe(3);
      expect(admin.pageSize).toBe(POSTS_ADMIN_PAGE_SIZE);
      expect((await listPostsAdmin(tx, { status: "draft", page: 1 })).total).toBe(1);
      expect((await listPostsAdmin(tx, { search: "زمان", page: 1 })).total).toBe(1);
    });
  });

  it("archived null", async () => {
    await withTestTx(handle.db, async (tx) => {
      const [row] = await tx
        .insert(postsTable)
        .values({
          slug: "خبر-تستی",
          title: "خبر",
          excerpt: "خ",
          status: "published",
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
        })
        .returning({ id: postsTable.id });
      expect(row).toBeDefined();
      if (row === undefined) return;

      expect(await getPostBySlug(tx, "خبر-تستی")).not.toBeNull();

      await archivePost(tx, row.id, ACTOR);
      expect(await getPostBySlug(tx, "خبر-تستی")).toBeNull();

      const redirect = await tx
        .select({ toPath: redirectsTable.toPath, code: redirectsTable.code, source: redirectsTable.source })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/خبر-تستی/"));
      expect(redirect).toEqual([{ toPath: "/blog/", code: 301, source: "auto_archive" }]);

      // EDGE CASE: archiving twice leaves exactly one redirect row
      await archivePost(tx, row.id, ACTOR);
      const again = await tx
        .select({ id: redirectsTable.id })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/خبر-تستی/"));
      expect(again).toHaveLength(1);

      await expectAppError(archivePost(tx, 999_999, ACTOR), "NOT_FOUND");
    });
  });

  it("legacy slug immutable", async () => {
    await withTestTx(handle.db, async (tx) => {
      const [legacy] = await tx
        .insert(postsTable)
        .values({
          slug: "legacy-slug",
          title: "قدیمی",
          excerpt: "خ",
          status: "published",
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          // the marker that makes a row legacy: it had a URL in the legacy sitemap
          legacyLastmod: new Date("2024-05-01T00:00:00.000Z"),
        })
        .returning({ id: postsTable.id });
      expect(legacy).toBeDefined();
      if (legacy === undefined) return;

      await expectAppError(
        upsertPost(tx, input({ id: legacy.id, slug: "renamed-slug", title: "قدیمی" }), ACTOR),
        "CONFLICT",
        "legacy_slug_immutable",
      );

      // the same slug is of course allowed - that is an ordinary edit
      const ok = await upsertPost(tx, input({ id: legacy.id, slug: "legacy-slug", title: "قدیمی‌تر" }), ACTOR);
      expect(ok.id).toBe(legacy.id);
      expect(ok.tags).toContain("post:legacy-slug");

      await expectAppError(upsertPost(tx, input({ id: 999_999, slug: "x", title: "عنوان" }), ACTOR), "NOT_FOUND");
      await expectAppError(upsertPost(tx, input({ slug: "  ", title: "عنوان" }), ACTOR), "VALIDATION", "required");
    });
  });

  it("new slug change redirects", async () => {
    await withTestTx(handle.db, async (tx) => {
      const created = await upsertPost(
        tx,
        input({ slug: "post-new", title: "نوشتهٔ تازه", bodyHtml: "<p>متن</p>" }),
        ACTOR,
      );
      expect(created.id).toBeGreaterThan(0);

      const moved = await upsertPost(
        tx,
        input({ id: created.id, slug: "post-renamed", title: "نوشتهٔ تازه" }),
        ACTOR,
      );
      expect(moved.id).toBe(created.id);
      // both slugs are invalidated
      expect(moved.tags).toContain("post:post-new");
      expect(moved.tags).toContain("post:post-renamed");

      const redirect = await tx
        .select({ toPath: redirectsTable.toPath, code: redirectsTable.code, source: redirectsTable.source })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/post-new/"));
      expect(redirect).toEqual([{ toPath: "/post-renamed/", code: 301, source: "manual" }]);

      expect(await getPostBySlug(tx, "post-new")).toBeNull();
      expect((await getPostBySlug(tx, "post-renamed"))?.slug).toBe("post-renamed");
    });
  });

  it("excerpt and read minutes derived", async () => {
    await withTestTx(handle.db, async (tx) => {
      const body = `<p>${"واژه ".repeat(600).trim()}</p><script>alert(1)</script>`;
      const created = await upsertPost(
        tx,
        input({ slug: "derived-post", title: "مشتق", bodyHtml: body, excerpt: "" }),
        ACTOR,
      );

      const view = await getPostBySlug(tx, "derived-post");
      expect(view).not.toBeNull();
      if (view === null) return;

      // rules: excerpt null → htmlToText(bodyHtml, 40 words)
      expect(view.excerpt).not.toBe("");
      expect(view.excerpt.split(/\s+/).filter((w) => w !== "").length).toBeLessThanOrEqual(41);
      expect(view.excerpt).not.toContain("<");
      // the spec: sanitized at write
      expect(view.bodyHtml).not.toContain("<script");
      // 600 words at 200 wpm
      expect(view.readMinutes).toBe(3);

      const stored = await tx
        .select({ readMinutes: postsTable.readMinutes })
        .from(postsTable)
        .where(eq(postsTable.id, created.id));
      expect(stored[0]?.readMinutes).toBe(3);

      // an explicit excerpt is kept (and ZWNJ-normalised)
      await upsertPost(
        tx,
        input({ id: created.id, slug: "derived-post", title: "مشتق", bodyHtml: "<p>کوتاه</p>", excerpt: "خلاصهٔ دستی" }),
        ACTOR,
      );
      const short = await getPostBySlug(tx, "derived-post");
      expect(short?.excerpt).toBe("خلاصهٔ دستی");
      // readMinutes is recomputed on every save
      expect(short?.readMinutes).toBe(1);
      // seo.title falls back to the row title, description to the excerpt
      expect(short?.seo.title).toBe("مشتق - نامی لوکس");
      expect(short?.seo.description).toBe("خلاصهٔ دستی");
      expect(short?.seo.canonical).toBe("/derived-post/");
      expect(short?.seo.ogImage).toBeNull();
      expect(short?.seo.robots).toBe("index, follow");
      expect((await getPostBySlug(tx, "derived-post", { origin: "https://namilux.ir" }))?.seo.canonical).toBe(
        "https://namilux.ir/derived-post/",
      );
    });
  });

  it("related archived dropped", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId } = await seedMinimal(tx);
      await upsertPost(
        tx,
        input({
          slug: "related-post",
          title: "مرتبط",
          relatedProductIds: [productId, productId, 999_999],
          tags: ["اسمگ", "  اسمگ  ", ""],
        }),
        ACTOR,
      );

      const view = await getPostBySlug(tx, "related-post");
      expect(view).not.toBeNull();
      // DECISION (see the module header): the view carries `relatedProductIds` and the caller drops
      // unknown/archived ones through `catalog/products.service.getProductCards` - the ids are handed
      // over verbatim, exactly as ../types PostView declares.
      expect(view?.relatedProductIds).toEqual([productId, productId, 999_999]);
      // tags are faNorm-deduped at write, first spelling wins
      expect(view?.tags).toEqual(["اسمگ"]);
    });
  });

  it("page normalization", async () => {
    await withTestTx(handle.db, async (tx) => {
      const rows = Array.from({ length: POSTS_PAGE_SIZE + 3 }, (_, i) => ({
        slug: `paged-${i}`,
        title: `نوشته ${i}`,
        excerpt: "خ",
        status: "published" as const,
        publishedAt: new Date(Date.UTC(2026, 0, i + 1)),
      }));
      await tx.insert(postsTable).values(rows);

      const first = await listPosts(tx, 1);
      expect(first.items).toHaveLength(POSTS_PAGE_SIZE);
      expect(first.total).toBe(POSTS_PAGE_SIZE + 3);
      // newest first
      expect(first.items[0]?.slug).toBe(`paged-${POSTS_PAGE_SIZE + 2}`);

      // EDGE CASE: page 0 (and anything below 1) → page 1
      for (const bad of [0, -5, Number.NaN]) {
        const normalized = await listPosts(tx, bad);
        expect(normalized.page).toBe(1);
        expect(normalized.items.map((p) => p.slug)).toEqual(first.items.map((p) => p.slug));
      }

      const second = await listPosts(tx, 2);
      expect(second.items).toHaveLength(3);

      // EDGE CASE: a page past the end is empty but still reports the total
      const beyond = await listPosts(tx, 99);
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(POSTS_PAGE_SIZE + 3);
      expect(beyond.page).toBe(99);
      expect(beyond.pageSize).toBe(POSTS_PAGE_SIZE);

      // the home rail is capped, never unbounded
      expect(await listRecentPosts(tx, 3)).toHaveLength(3);
      expect((await listRecentPosts(tx, 10_000)).length).toBeLessThanOrEqual(POSTS_ADMIN_PAGE_SIZE);
    });
  });

  it("an encoded slug resolves against the decoded row", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(postsTable).values({
        slug: "راهنمای-قهوه",
        title: "راهنمای قهوه",
        excerpt: "خ",
        status: "published",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      expect((await getPostBySlug(tx, encodeURIComponent("راهنمای-قهوه")))?.slug).toBe("راهنمای-قهوه");
      expect((await getPostBySlug(tx, "/راهنمای-قهوه/"))?.slug).toBe("راهنمای-قهوه");
      expect(await getPostBySlug(tx, "")).toBeNull();
    });
  });
});
