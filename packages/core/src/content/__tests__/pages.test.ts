import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, faqs as faqsTable, pages as pagesTable, redirects as redirectsTable } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
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

// DECISION: ../../cache/invalidation is unbuilt at the time; the mock returns exactly the list its own header
// specifies for `tagsForPageChange` ("page:slug, content, sitemap").
vi.mock("../../cache/invalidation", () => ({
  tagsForPostChange: (slug: string) => [`post:${slug}`, "content", "home", "sitemap"],
  tagsForPageChange: (slug: string) => [`page:${slug}`, "content", "sitemap"],
}));

/** The paths the stand-in validator treats as serving 200 (`content/redirects.STATIC_ROUTES` subset). */
const LIVE_PATHS = ["/", "/shop/", "/blog/", "/about-us/"];

// DECISION: ../../catalog/archive is unbuilt at the time - `validateRedirectTarget` throws. The stand-in
// enforces the two rules pages.ts relies on (site-relative + trailing slash, and "must serve 200"),
// which is what the "archive target must be live" EDGE CASE is about.
vi.mock("../../catalog/archive", async () => {
  const { appError } = await import("../../errors");
  return {
    redirectTargetForPost: () => "/blog/",
    redirectTargetForBrand: () => "/shop/",
    validateRedirectTarget: (fromPath: string, toPath: string) => {
      if (!toPath.startsWith("/") || toPath.startsWith("//") || !toPath.endsWith("/")) {
        throw appError("VALIDATION", { details: { field: "redirectTo", reason: "bad_target_shape" } });
      }
      if (toPath === fromPath) {
        throw appError("VALIDATION", { details: { field: "redirectTo", reason: "redirect_loop" } });
      }
      if (!LIVE_PATHS.includes(toPath)) {
        throw appError("VALIDATION", { details: { field: "redirectTo", reason: "target_not_live" } });
      }
    },
  };
});

import { LEGAL_TEMPLATES, archivePage, getPageBySlug, getPageByTemplate, listPagesForSitemap, upsertPage } from "../pages";
import type { PageInput } from "../pages";
import { getFaqs } from "../faq";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "staff-test" };

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

const input = (over: Partial<PageInput> & Pick<PageInput, "slug" | "title">): PageInput => ({
  bodyHtml: "<p>متن</p>",
  template: "default",
  status: "published",
  robots: "index, follow",
  ...over,
});

// ── pure ───────────────────────────────────────────────────────────────────────────────────────

describe("legal templates", () => {
  it("are the four enamad requires", () => {
    expect([...LEGAL_TEMPLATES].sort()).toEqual(["privacy", "returns", "terms", "warranty"]);
  });
});

// ── integration ────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasTestDb())("pages against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("single page per template", async () => {
    await withTestTx(handle.db, async (tx) => {
      const first = await upsertPage(tx, input({ slug: "contact-us", title: "تماس", template: "contact" }), ACTOR);
      expect(first.tags).toContain("page:contact-us");

      // EDGE CASE: a second PUBLISHED page on the same singleton template
      await expectAppError(
        upsertPage(tx, input({ slug: "contact-2", title: "تماس ۲", template: "contact" }), ACTOR),
        "VALIDATION",
        "template_already_published",
      );

      // a draft second one is fine - only one may be live
      const draft = await upsertPage(
        tx,
        input({ slug: "contact-2", title: "تماس ۲", template: "contact", status: "draft" }),
        ACTOR,
      );
      expect(draft.id).toBeGreaterThan(0);

      // re-saving the first one does not collide with itself
      const again = await upsertPage(
        tx,
        input({ id: first.id, slug: "contact-us", title: "تماس با ما", template: "contact" }),
        ACTOR,
      );
      expect(again.id).toBe(first.id);
      // rules: «+ nav when the title changed»
      expect(again.tags).toContain("nav");

      // `default` is unlimited
      await upsertPage(tx, input({ slug: "page-a", title: "الف" }), ACTOR);
      await upsertPage(tx, input({ slug: "page-b", title: "ب" }), ACTOR);

      expect((await getPageByTemplate(tx, "contact"))?.slug).toBe("contact-us");
      expect(await getPageByTemplate(tx, "store")).toBeNull();
    });
  });

  it("legal pages cannot be archived", async () => {
    await withTestTx(handle.db, async (tx) => {
      const privacy = await upsertPage(
        tx,
        input({ slug: "حریم-خصوصی-کاربران", title: "حریم خصوصی", template: "privacy" }),
        ACTOR,
      );

      // EDGE CASE: archive a "privacy" page → VALIDATION
      await expectAppError(
        archivePage(tx, privacy.id, "/", ACTOR),
        "VALIDATION",
        "legal_page_must_stay_published",
      );

      // …and it cannot be demoted to draft/archived through upsert either
      for (const status of ["draft", "archived"] as const) {
        await expectAppError(
          upsertPage(
            tx,
            input({ id: privacy.id, slug: "حریم-خصوصی-کاربران", title: "حریم خصوصی", template: "privacy", status }),
            ACTOR,
          ),
          "VALIDATION",
          "legal_page_must_stay_published",
        );
      }

      // a contract URL on a non-legal template is protected too (the spec page-sitemap.xml)
      const about = await upsertPage(tx, input({ slug: "about-us", title: "درباره ما" }), ACTOR);
      await expectAppError(
        archivePage(tx, about.id, "/shop/", ACTOR),
        "VALIDATION",
        "contract_url_must_serve_200",
      );

      expect((await getPageBySlug(tx, "حریم-خصوصی-کاربران"))?.template).toBe("privacy");
    });
  });

  it("archive target must be live", async () => {
    await withTestTx(handle.db, async (tx) => {
      const page = await upsertPage(tx, input({ slug: "old-page", title: "صفحهٔ قدیمی" }), ACTOR);

      await expectAppError(archivePage(tx, page.id, "", ACTOR), "VALIDATION", "required");
      await expectAppError(archivePage(tx, page.id, "/shop", ACTOR), "VALIDATION", "bad_target_shape");
      await expectAppError(
        archivePage(tx, page.id, "https://evil.example/", ACTOR),
        "VALIDATION",
        "bad_target_shape",
      );
      await expectAppError(archivePage(tx, page.id, "/no-such-page/", ACTOR), "VALIDATION", "target_not_live");
      // a missing page is NOT_FOUND before the target is ever looked at
      await expectAppError(archivePage(tx, 999_999, "/shop/", ACTOR), "NOT_FOUND");

      // nothing was written by the rejected attempts
      expect((await getPageBySlug(tx, "old-page"))?.status).toBe("published");

      await archivePage(tx, page.id, "/shop/", ACTOR);
      expect(await getPageBySlug(tx, "old-page")).toBeNull();

      const redirect = await tx
        .select({ toPath: redirectsTable.toPath, code: redirectsTable.code, source: redirectsTable.source })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/old-page/"));
      expect(redirect).toEqual([{ toPath: "/shop/", code: 301, source: "auto_archive" }]);

      // EDGE CASE: archiving twice leaves exactly one redirect row
      await archivePage(tx, page.id, "/shop/", ACTOR);
      const again = await tx
        .select({ id: redirectsTable.id })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/old-page/"));
      expect(again).toHaveLength(1);
    });
  });

  it("faq template attaches faqs", async () => {
    await withTestTx(handle.db, async (tx) => {
      await upsertPage(
        tx,
        input({ slug: "faq", title: "پرسش‌های پرتکرار", template: "faq", bodyHtml: "<p>مقدمه</p>" }),
        ACTOR,
      );
      await tx.insert(faqsTable).values([
        { groupKey: "general", question: "ساعت کاری", answerHtml: "<p>۹ تا ۱۸</p>", sort: 0 },
        { groupKey: "shipping", question: "ارسال", answerHtml: "<p>۳ روز</p>", sort: 0 },
        { groupKey: "shipping", question: "غیرفعال", answerHtml: "<p>خ</p>", sort: 1, isActive: false },
      ]);

      const page = await getPageBySlug(tx, "faq");
      expect(page).not.toBeNull();
      expect(page?.template).toBe("faq");
      expect(page?.bodyHtml).toContain("مقدمه");

      // DECISION (see the module header): the FAQ page composes its accordions from `getFaqs(db)`
      // - ../types PageView has no `faqs` slot, and one query per template kind stays out of the
      // other eight page renders. EDGE CASE "zero active faqs" is the empty array below.
      const faqs = await getFaqs(tx);
      expect(faqs.map((f) => f.question)).toEqual(["ساعت کاری", "ارسال"]);
      expect(await getFaqs(tx, "warranty")).toEqual([]);
    });
  });

  it("draft null", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(pagesTable).values([
        { slug: "draft-page", title: "پیش‌نویس", status: "draft" },
        { slug: "archived-page", title: "بایگانی", status: "archived" },
        { slug: "live-page", title: "زنده", status: "published" },
      ]);

      expect(await getPageBySlug(tx, "draft-page")).toBeNull();
      expect(await getPageBySlug(tx, "archived-page")).toBeNull();
      expect(await getPageBySlug(tx, "")).toBeNull();

      const live = await getPageBySlug(tx, "live-page");
      expect(live?.slug).toBe("live-page");
      expect(live?.seo.title).toBe("زنده - نامی لوکس");
      expect(live?.seo.description).toBeNull();
      expect(live?.seo.canonical).toBe("/live-page/");
      expect(live?.seo.ogImage).toBeNull();
      expect(live?.seo.robots).toBe("index, follow");
      expect(typeof live?.seo.lastmod).toBe("string");
      expect((await getPageBySlug(tx, "live-page", { origin: "https://namilux.ir" }))?.seo.canonical).toBe(
        "https://namilux.ir/live-page/",
      );

      // only published pages reach the sitemap
      expect((await listPagesForSitemap(tx)).map((p) => p.slug)).toEqual(["live-page"]);
    });
  });

  it("legacy slug immutable", async () => {
    await withTestTx(handle.db, async (tx) => {
      const [legacy] = await tx
        .insert(pagesTable)
        .values({
          slug: "legacy-page",
          title: "قدیمی",
          status: "published",
          legacyLastmod: new Date("2024-05-01T00:00:00.000Z"),
        })
        .returning({ id: pagesTable.id });
      expect(legacy).toBeDefined();
      if (legacy === undefined) return;

      await expectAppError(
        upsertPage(tx, input({ id: legacy.id, slug: "renamed-page", title: "قدیمی" }), ACTOR),
        "CONFLICT",
        "legacy_slug_immutable",
      );

      // a NEW page may be renamed, and the old slug 301s to the new one
      const created = await upsertPage(tx, input({ slug: "page-new", title: "تازه" }), ACTOR);
      const moved = await upsertPage(tx, input({ id: created.id, slug: "page-moved", title: "تازه" }), ACTOR);
      expect(moved.id).toBe(created.id);
      expect(moved.tags).toContain("page:page-new");
      expect(moved.tags).toContain("page:page-moved");

      const redirect = await tx
        .select({ toPath: redirectsTable.toPath, code: redirectsTable.code, source: redirectsTable.source })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/page-new/"));
      expect(redirect).toEqual([{ toPath: "/page-moved/", code: 301, source: "manual" }]);

      await expectAppError(upsertPage(tx, input({ id: 999_999, slug: "x", title: "عنوان" }), ACTOR), "NOT_FOUND");
      await expectAppError(upsertPage(tx, input({ slug: "y", title: "  " }), ACTOR), "VALIDATION", "required");
    });
  });
});
