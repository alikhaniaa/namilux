import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, pages, posts, products, redirects as redirectsTable, events } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

// DECISION: ../../audit is owned by another module and not yet built when this was written (its `log` throws); the mock
// is the documented no-op signature so these tests stay a test of redirects.ts.
vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import {
  STATIC_REDIRECT_RULES,
  STATIC_ROUTES,
  flushRedirectHits,
  importRedirectsCsv,
  insertRedirect,
  listNotFound,
  listRedirects,
  matchStaticRedirect,
  normalizePath,
  recordNotFound,
  resolveFinalTarget,
  resolveRedirect,
  resolveRootSlug,
  setRedirectActive,
} from "../redirects";
import type { RedirectHit } from "../redirects";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import { encSeg } from "../../url";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "staff-test" };

/** The guard rejects before any query runs, so the pure tests need no connection. */
const NO_DB = {} as unknown as Db;

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

// ── pure: normalizePath ────────────────────────────────────────────────────────────────────────

describe("normalizePath table", () => {
  const cases: [input: string, expected: string][] = [
    ["/Product/Foo//bar?x=1#h", "/product/foo/bar/"],
    ["/robots.txt", "/robots.txt"],
    ["/locations.kml", "/locations.kml"],
    ["/sitemap.xml", "/sitemap.xml"],
    ["", "/"],
    ["   ", "/"],
    ["/", "/"],
    ["//", "/"],
    ["///shop///", "/shop/"],
    ["/shop", "/shop/"],
    ["  /shop/  ", "/shop/"],
    ["shop", "/shop/"],
    ["/SHOP/?page=2", "/shop/"],
    ["/shop/#top", "/shop/"],
    ["/%d8%a2%d8%a8/", "/آب/"],
    ["/product/%da%a9%d8%aa%d8%b1%db%8c/", "/product/کتری/"],
    // an extension must start with a letter, so a version-numbered slug keeps its trailing slash
    ["/product/kf-2.0", "/product/kf-2.0/"],
  ];

  it.each(cases)("normalizePath(%j) → %j", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("normalizes to NFC and is idempotent", () => {
    // ALEF (U+0627) + MADDAH ABOVE (U+0653) → ALEF WITH MADDA ABOVE (U+0622)
    expect(normalizePath("/آ/")).toBe("/آ/");
    const once = normalizePath("/Product/Foo//bar?x=1#h");
    expect(normalizePath(once)).toBe(once);
    expect(normalizePath(normalizePath("/robots.txt"))).toBe("/robots.txt");
  });

  it("drops control characters (no header splitting through a stored target)", () => {
    expect(normalizePath("/sho\u0000p/")).toBe("/shop/");
    expect(normalizePath("/shop/\r\n")).toBe("/shop/");
    expect(normalizePath("/sho%0dp/")).toBe("/shop/");
  });
});

// ── pure: the static rule table ────────────────────────────────────────────────────────────────

describe("static rule table", () => {
  const enc = encSeg("توستر-اسمگ");
  const cases: [input: string, expected: RedirectHit | null][] = [
    ["/checkout/", { to: "/billing/", code: 301 }],
    ["/checkout", { to: "/billing/", code: 301 }],
    ["/checkout/order-received/123/", { to: "/billing/", code: 301 }],
    ["/my-account/", { to: "/account/", code: 301 }],
    ["/my-account/orders/", { to: "/account/orders/", code: 301 }],
    ["/my-account/orders/view/12/", { to: "/account/orders/", code: 301 }],
    ["/my-account/edit-address/billing/", { to: "/account/addresses/", code: 301 }],
    ["/my-account/lost-password/", { to: "/account/", code: 301 }],
    ["/shop/page/3/", { to: "/shop/?page=3", code: 301 }],
    ["/shop/page/1/", { to: "/shop/", code: 301 }],
    ["/blog/page/2/", { to: "/blog/?page=2", code: 301 }],
    ["/brand/smeg/page/4/", { to: "/brand/smeg/?page=4", code: 301 }],
    [`/category/توستر-اسمگ/page/2/`, { to: `/category/${enc}/?page=2`, code: 301 }],
    ["/sitemap.xml", { to: "/sitemap_index.xml", code: 301 }],
    ["/locations.kml", { to: "", code: 410 }],
    [`/product-category/توستر-اسمگ/`, { to: `/category/${enc}/`, code: 301 }],
    // no path to carry over → no match, the router falls through to the table and then to 404
    ["/product-category/", null],
    ["/", null],
    ["/shop/", null],
    ["/blog/", null],
    ["/product/کتری/", null],
    ["/آموزش-توستر/", null],
    // the root namespace is NOT paginated by the rule (only /shop/ /category/ /brand/ /blog/)
    ["/آموزش-توستر/page/2/", null],
    ["/robots.txt", null],
  ];

  it.each(cases)("matchStaticRedirect(%j)", (input, expected) => {
    expect(matchStaticRedirect(input)).toEqual(expected);
  });

  it("evaluates in order - the first match wins", () => {
    expect(STATIC_REDIRECT_RULES.map((r) => r.name)).toEqual([
      "checkout",
      "my-account",
      "pagination",
      "sitemap",
      "locations-kml",
      "product-category",
    ]);
    // "/checkout/page/2/" matches both rule 1 and rule 3 shapes; rule 1 is first.
    expect(matchStaticRedirect("/checkout/page/2/")).toEqual({ to: "/billing/", code: 301 });
  });

  it("accepts an encoded, query-carrying request path", () => {
    expect(matchStaticRedirect("/%63heckout/?utm_source=ig")).toEqual({ to: "/billing/", code: 301 });
    expect(matchStaticRedirect(`/product-category/${encSeg("توستر-اسمگ")}/?x=1`)).toEqual({
      to: `/category/${encSeg("توستر-اسمگ")}/`,
      code: 301,
    });
  });

  it("never redirects a path a fixed route serves", () => {
    for (const route of STATIC_ROUTES) expect(matchStaticRedirect(route)).toBeNull();
  });
});

// ── pure: malformed percent-encoding ───────────────────────────────────────────────────────────

describe("malformed encoding safe", () => {
  it("leaves a malformed segment as-is and never throws", () => {
    expect(() => normalizePath("/x/%zz/")).not.toThrow();
    expect(normalizePath("/x/%zz/")).toBe("/x/%zz/");
    expect(normalizePath("/%/")).toBe("/%/");
    expect(normalizePath("/%e0%a4/")).toBe("/%e0%a4/");
  });

  it("re-encodes a malformed segment when it becomes a target", () => {
    // encSeg("%zz") → "%25zz" is the documented behaviour of url/encode.ts (callers pass DECODED input)
    expect(matchStaticRedirect("/product-category/%zz/")).toEqual({ to: "/category/%25zz/", code: 301 });
  });
});

// ── pure: the open-redirect guard ──────────────────────────────────────────────────────────────

describe("open redirect guard", () => {
  const hostile = [
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "javascript:alert(1)",
    "http://namilux.ir.evil.example/",
    "evil.example/shop/",
  ];

  it.each(hostile)("rejects the target %j before touching the database", async (toPath) => {
    await expectAppError(
      insertRedirect(NO_DB, { fromPath: "/old-thing/", toPath, code: 301, source: "manual" }, ACTOR),
      "VALIDATION",
      "must_be_site_relative",
    );
  });

  it("rejects a hostile from_path too", async () => {
    await expectAppError(
      insertRedirect(NO_DB, { fromPath: "//evil.example/", toPath: "/shop/", code: 301, source: "manual" }, ACTOR),
      "VALIDATION",
      "must_be_site_relative",
    );
  });

  it("rejects from == to and a 410 row that carries a target", async () => {
    await expectAppError(
      insertRedirect(NO_DB, { fromPath: "/thing/", toPath: "/thing/", code: 301, source: "manual" }, ACTOR),
      "VALIDATION",
      "from_equals_to",
    );
    await expectAppError(
      insertRedirect(NO_DB, { fromPath: "/thing/", toPath: "/shop/", code: 410, source: "manual" }, ACTOR),
      "VALIDATION",
      "gone_rows_have_no_target",
    );
  });
});

// ── integration (Postgres) ─────────────────────────────────────────────────────────────────────

describe.skipIf(!hasTestDb())("redirects against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await flushRedirectHits();
    await handle.close();
  });

  const add = (
    db: Db,
    row: { fromPath: string; toPath: string; code?: 301 | 410; isActive?: boolean },
  ): Promise<unknown> =>
    db.insert(redirectsTable).values({
      fromPath: row.fromPath,
      toPath: row.toPath,
      code: row.code ?? 301,
      source: "legacy",
      isActive: row.isActive ?? true,
    });

  it("resolves an exact active row, emits the target encoded and counts the hit", async () => {
    await withTestTx(handle.db, async (tx) => {
      await add(tx, { fromPath: "/category/بلاگ/", toPath: "/blog/" });
      await add(tx, { fromPath: "/legacy-fa/", toPath: "/category/توستر-اسمگ/" });
      await add(tx, { fromPath: "/locations.kml", toPath: "", code: 410 });

      expect(await resolveRedirect(tx, "/category/بلاگ/")).toEqual({ to: "/blog/", code: 301 });
      // an encoded request path resolves against the decoded row
      expect(await resolveRedirect(tx, `/category/${encSeg("بلاگ")}/`)).toEqual({ to: "/blog/", code: 301 });
      // to_path is stored decoded and emitted encoded (rules)
      expect(await resolveRedirect(tx, "/legacy-fa/")).toEqual({
        to: `/category/${encSeg("توستر-اسمگ")}/`,
        code: 301,
      });
      expect(await resolveRedirect(tx, "/locations.kml")).toEqual({ to: "", code: 410 });
      expect(await resolveRedirect(tx, "/nothing-here/")).toBeNull();

      await flushRedirectHits();
      const [row] = await tx
        .select({ hits: redirectsTable.hits, lastHitAt: redirectsTable.lastHitAt })
        .from(redirectsTable)
        .where(eq(redirectsTable.fromPath, "/category/بلاگ/"))
        .limit(1);
      expect(row?.hits).toBe(2);
      expect(row?.lastHitAt).not.toBeNull();
    });
  });

  it("inactive row ignored", async () => {
    await withTestTx(handle.db, async (tx) => {
      const [row] = await tx
        .insert(redirectsTable)
        .values({ fromPath: "/disabled/", toPath: "/shop/", code: 301, source: "manual", isActive: false })
        .returning({ id: redirectsTable.id });
      expect(row).toBeDefined();
      expect(await resolveRedirect(tx, "/disabled/")).toBeNull();

      await setRedirectActive(tx, row?.id ?? 0, true, ACTOR);
      expect(await resolveRedirect(tx, "/disabled/")).toEqual({ to: "/shop/", code: 301 });

      await setRedirectActive(tx, row?.id ?? 0, false, ACTOR);
      expect(await resolveRedirect(tx, "/disabled/")).toBeNull();

      await expectAppError(setRedirectActive(tx, 987_654_321, true, ACTOR), "NOT_FOUND");
      await flushRedirectHits();
    });
  });

  it("redirect resolution precedence (entity beats row)", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(pages).values({ slug: "about-us", title: "درباره ما", status: "published" });
      await add(tx, { fromPath: "/about-us/", toPath: "/shop/" });

      // the entity wins for the router …
      expect(await resolveRootSlug(tx, "about-us")).toEqual({ kind: "page", slug: "about-us" });
      // … even though the stale row is still resolvable on its own
      expect(await resolveRedirect(tx, "/about-us/")).toEqual({ to: "/shop/", code: 301 });

      // and the write side refuses to create such a row in the first place
      await expectAppError(
        insertRedirect(tx, { fromPath: "/about-us/", toPath: "/blog/", code: 301, source: "manual" }, ACTOR),
        "CONFLICT",
        "path_serves_200",
      );
      await flushRedirectHits();
    });
  });

  it("chain collapse", async () => {
    await withTestTx(handle.db, async (tx) => {
      const b = await insertRedirect(
        tx,
        { fromPath: "/b-old/", toPath: "/c-new/", code: 301, source: "manual" },
        ACTOR,
      );
      expect(b.id).toBeGreaterThan(0);
      await insertRedirect(tx, { fromPath: "/a-old/", toPath: "/b-old/", code: 301, source: "manual" }, ACTOR);

      // A → B was stored as A → C: exactly one lookup happens at resolve time
      expect(await resolveRedirect(tx, "/a-old/")).toEqual({ to: "/c-new/", code: 301 });
      expect(await resolveFinalTarget(tx, "/a-old/")).toBe("/c-new/");
      // maxHops 0 disables following
      expect(await resolveFinalTarget(tx, "/a-old/", 0)).toBe("/a-old/");
      // a 410 in the chain ends the walk
      await add(tx, { fromPath: "/c-new/", toPath: "", code: 410 });
      expect(await resolveFinalTarget(tx, "/a-old/")).toBe("/c-new/");
      await flushRedirectHits();
    });
  });

  it("loop rejected", async () => {
    await withTestTx(handle.db, async (tx) => {
      await insertRedirect(tx, { fromPath: "/b-old/", toPath: "/c-new/", code: 301, source: "manual" }, ACTOR);
      await insertRedirect(tx, { fromPath: "/a-old/", toPath: "/b-old/", code: 301, source: "manual" }, ACTOR);

      // C → A closes the cycle A → C → A
      await expectAppError(
        insertRedirect(tx, { fromPath: "/c-new/", toPath: "/a-old/", code: 301, source: "manual" }, ACTOR),
        "VALIDATION",
        "redirect_loop",
      );

      // a cycle already present in the table is reported by resolveFinalTarget itself
      await add(tx, { fromPath: "/loop-x/", toPath: "/loop-y/" });
      await add(tx, { fromPath: "/loop-y/", toPath: "/loop-x/" });
      await expectAppError(resolveFinalTarget(tx, "/loop-x/"), "VALIDATION", "redirect_loop");
    });
  });

  it("manual insert on live path conflicts", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx
        .insert(products)
        .values({ slug: "kettle-live", name: "Kettle", displayName: "کتری برقی", status: "active" });

      await expectAppError(
        insertRedirect(
          tx,
          { fromPath: "/product/kettle-live/", toPath: "/shop/", code: 301, source: "manual" },
          ACTOR,
        ),
        "CONFLICT",
        "path_serves_200",
      );

      // the archive flow may - it flips the entity in the same transaction
      const created = await insertRedirect(
        tx,
        { fromPath: "/product/kettle-live/", toPath: "/shop/", code: 301, source: "auto_archive" },
        ACTOR,
      );
      expect(created.id).toBeGreaterThan(0);

      // a second row for the same from_path is a conflict, never a silent overwrite
      await expectAppError(
        insertRedirect(
          tx,
          { fromPath: "/product/kettle-live/", toPath: "/blog/", code: 301, source: "auto_archive" },
          ACTOR,
        ),
        "CONFLICT",
        "redirect_exists",
      );

      // a static route is live too
      await expectAppError(
        insertRedirect(tx, { fromPath: "/shop/", toPath: "/blog/", code: 301, source: "manual" }, ACTOR),
        "CONFLICT",
        "path_serves_200",
      );
    });
  });

  it("root slug precedence", async () => {
    await withTestTx(handle.db, async (tx) => {
      const past = new Date(Date.now() - 86_400_000);
      const future = new Date(Date.now() + 86_400_000);
      await tx
        .insert(posts)
        .values({ slug: "shared-slug", title: "نوشته", status: "published", publishedAt: past });
      await tx.insert(pages).values({ slug: "shared-slug", title: "برگه", status: "published" });
      await tx.insert(pages).values({ slug: "only-page", title: "برگه", status: "published" });
      await tx.insert(pages).values({ slug: "draft-page", title: "پیش‌نویس", status: "draft" });
      await tx
        .insert(posts)
        .values({ slug: "scheduled-post", title: "زمان‌بندی", status: "published", publishedAt: future });
      await add(tx, { fromPath: "/gone-slug/", toPath: "/blog/" });
      await add(tx, { fromPath: "/scheduled-post/", toPath: "/blog/" });

      expect(await resolveRootSlug(tx, "shared-slug")).toEqual({ kind: "post", slug: "shared-slug" });
      expect(await resolveRootSlug(tx, "only-page")).toEqual({ kind: "page", slug: "only-page" });
      expect(await resolveRootSlug(tx, "gone-slug")).toEqual({ kind: "redirect", to: "/blog/", code: 301 });
      expect(await resolveRootSlug(tx, "draft-page")).toBeNull();
      expect(await resolveRootSlug(tx, "nothing-at-all")).toBeNull();
      expect(await resolveRootSlug(tx, "")).toBeNull();
      // a scheduled post is not public yet → the row behind it answers
      expect(await resolveRootSlug(tx, "scheduled-post")).toEqual({
        kind: "redirect",
        to: "/blog/",
        code: 301,
      });
      // … until `now` passes its publication date
      expect(await resolveRootSlug(tx, "scheduled-post", { now: new Date(Date.now() + 172_800_000) })).toEqual({
        kind: "post",
        slug: "scheduled-post",
      });
      // the slug arrives from the router encoded and slashed
      expect(await resolveRootSlug(tx, "/Only-Page/")).toEqual({ kind: "page", slug: "only-page" });
      await flushRedirectHits();
    });
  });

  it("404 monitor filters and throttles", async () => {
    await withTestTx(handle.db, async (tx) => {
      const countFor = async (path: string): Promise<number> => {
        const rows = await tx
          .select({ ref: events.ref })
          .from(events)
          .where(and(eq(events.type, "404"), eq(events.path, path)));
        return rows.length;
      };

      // noise is never recorded
      await recordNotFound(tx, "/api/checkout/quote");
      await recordNotFound(tx, "/_next/static/chunks/main.js");
      await recordNotFound(tx, "/style.css");
      await recordNotFound(tx, "/favicon.ico");
      expect(await countFor("/api/checkout/quote/")).toBe(0);
      expect(await countFor("/_next/static/chunks/main.js")).toBe(0);
      expect(await countFor("/style.css")).toBe(0);

      // a legacy .html path IS a candidate redirect
      await recordNotFound(tx, "/old-article.html", "https://www.google.com/search?q=namilux#hit");
      expect(await countFor("/old-article.html")).toBe(1);

      // the same path twice within a minute is one write
      await recordNotFound(tx, "/missing-thing/", "https://instagram.com/namilux.ir");
      await recordNotFound(tx, "/missing-thing/", "https://instagram.com/namilux.ir");
      await recordNotFound(tx, "/MISSING-thing/?utm=1");
      expect(await countFor("/missing-thing/")).toBe(1);

      const [stored] = await tx
        .select({ ref: events.ref })
        .from(events)
        .where(and(eq(events.type, "404"), eq(events.path, "/old-article.html")))
        .limit(1);
      // the referrer is stripped of its query string and hash
      expect(stored?.ref).toBe("https://www.google.com/search");

      const monitor = await listNotFound(tx, { days: 7, page: 1 });
      expect(monitor.page).toBe(1);
      expect(monitor.total).toBeGreaterThanOrEqual(2);
      const article = monitor.items.find((i) => i.path === "/old-article.html");
      expect(article?.hits).toBe(1);
      expect(article?.referrers).toEqual(["https://www.google.com/search"]);
      expect(typeof article?.lastAt).toBe("string");
      // a window that ends before the writes returns nothing
      expect((await listNotFound(tx, { days: 0, page: 0 })).page).toBe(1);
    });
  });

  it("lists and imports rows for the admin manager", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(redirectsTable).values([
        { fromPath: "/imp-a/", toPath: "/shop/", code: 301, source: "legacy", hits: 9 },
        { fromPath: "/imp-b/", toPath: "/blog/", code: 301, source: "manual", hits: 40 },
      ]);

      const all = await listRedirects(tx, { page: 1, search: "/imp-" });
      expect(all.pageSize).toBe(50);
      expect(all.total).toBe(2);
      // most-hit first
      expect(all.items[0]?.fromPath).toBe("/imp-b/");
      expect(all.items[0]).toMatchObject({ code: 301, source: "manual", isActive: true, hits: 40 });
      expect(all.items[0]?.lastHitAt).toBeNull();

      const bySource = await listRedirects(tx, { page: 1, source: "legacy" });
      expect(bySource.items.every((r) => r.source === "legacy")).toBe(true);

      const bySearch = await listRedirects(tx, { page: 1, search: "imp-a" });
      expect(bySearch.total).toBe(1);
      expect(bySearch.items[0]?.fromPath).toBe("/imp-a/");
      // a wildcard in the search term is escaped, not interpreted
      expect((await listRedirects(tx, { page: 1, search: "%" })).total).toBe(0);

      const dry = await importRedirectsCsv(
        tx,
        [
          { from: "/csv-one/", to: "/shop/" },
          { from: "/imp-a/", to: "/shop/" },
          { from: "/csv-gone/", to: "", code: "410" },
          { from: "/csv-bad/", to: "https://evil.example/" },
        ],
        ACTOR,
        true,
      );
      expect(dry).toMatchObject({ inserted: 2, skipped: 1 });
      expect(dry.errors).toHaveLength(1);
      expect(dry.errors[0]?.line).toBe(4);
      expect(await resolveRedirect(tx, "/csv-one/")).toBeNull();

      const wet = await importRedirectsCsv(
        tx,
        [
          { from: "/csv-one/", to: "/shop/" },
          { from: "/imp-a/", to: "/shop/" },
          { from: "/csv-gone/", to: "", code: "410" },
        ],
        ACTOR,
        false,
      );
      expect(wet).toMatchObject({ inserted: 2, skipped: 1, errors: [] });
      expect(await resolveRedirect(tx, "/csv-one/")).toEqual({ to: "/shop/", code: 301 });
      expect(await resolveRedirect(tx, "/csv-gone/")).toEqual({ to: "", code: 410 });
      await flushRedirectHits();
    });
  });
});
