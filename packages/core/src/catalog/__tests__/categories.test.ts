import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  categories as categoriesTable,
  inArray,
  like,
  products as productsTable,
  productCategories,
  redirects as redirectsTable,
  sql,
} from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import {
  ancestorIds,
  buildPath,
  categoryPagePath,
  crumbsFor,
  descendantIds,
  getCategoryByPath,
  listCategoryTree,
  upsertCategory,
} from "../categories";
import type { CategoryInput } from "../categories";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import { ROUTES, categoryUrl } from "../../url";
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

// ── pure ───────────────────────────────────────────────────────────────────────────────────────

describe("buildPath table", () => {
  const cases: [parent: string | null, slug: string, expected: string][] = [
    [null, "توستر-اسمگ", "توستر-اسمگ"],
    ["توستر-اسمگ", "توستر-کوچک-اسمگ", "توستر-اسمگ/توستر-کوچک-اسمگ"],
    ["توستر-اسمگ/زیرشاخه", "برگ", "توستر-اسمگ/زیرشاخه/برگ"],
    // slashes on either side are normalised away, never doubled
    ["/توستر-اسمگ/", "/توستر-کوچک-اسمگ/", "توستر-اسمگ/توستر-کوچک-اسمگ"],
    ["  ", "solo", "solo"],
    ["", "solo", "solo"],
  ];

  it.each(cases)("buildPath(%j, %j) → %j", (parent, slug, expected) => {
    expect(buildPath(parent, slug)).toBe(expected);
  });

  it("refuses an empty slug (it would mint /category//)", () => {
    expect(() => buildPath(null, "   ")).toThrow(RangeError);
    expect(() => buildPath("توستر-اسمگ", "")).toThrow(RangeError);
  });

  it("categoryPagePath normalises what a caller passes by mistake", () => {
    expect(categoryPagePath("توستر-اسمگ")).toBe("/category/توستر-اسمگ/");
    expect(categoryPagePath("/category/توستر-اسمگ/")).toBe("/category/توستر-اسمگ/");
    expect(categoryPagePath("category/a/b")).toBe("/category/a/b/");
    expect(() => categoryPagePath("/category/")).toThrow(RangeError);
  });
});

// ── database ───────────────────────────────────────────────────────────────────────────────────

/** The seed's max legacy category id - a row at or below it has a frozen path. */
const LEGACY_ID = 287;
/** Every other fixture id is far above the legacy block, so it is a "new" row the admin may move. */
const BASE = 810_000;
const ROOT_ID = BASE + 1;
const CHILD_ID = BASE + 2;
const HIDDEN_ID = BASE + 3;
const ARCHIVED_ID = BASE + 4;
const EMPTY_ID = BASE + 5;
const MOVABLE_ID = BASE + 6;
const MOVABLE_CHILD_ID = BASE + 7;
const PRODUCT_A = BASE + 11;
const PRODUCT_B = BASE + 12;

const FIXTURE_IDS = [LEGACY_ID, ROOT_ID, CHILD_ID, HIDDEN_ID, ARCHIVED_ID, EMPTY_ID, MOVABLE_ID, MOVABLE_CHILD_ID];

const PREFIX = "catt";
const ROOT_PATH = `${PREFIX}-توستر-اسمگ`;
const CHILD_SLUG = `${PREFIX}-توستر-کوچک`;
const CHILD_PATH = `${ROOT_PATH}/${CHILD_SLUG}`;
const HIDDEN_PATH = `${PREFIX}-پنهان`;
const EMPTY_PATH = `${PREFIX}-خالی`;

/** The fields `CategoryInput` requires that these tests do not vary. */
const inputDefaults = {
  descriptionHtml: "",
  seoTitle: null,
  seoDescription: null,
  robots: "index, follow",
  inSitemap: true,
  status: "active" as const,
  sort: 0,
};

describe.skipIf(!hasTestDb())("categories against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  async function seed(tx: Db): Promise<void> {
    await tx.insert(categoriesTable).values([
      { id: LEGACY_ID, slug: `${PREFIX}-legacy`, path: `${PREFIX}-legacy`, name: "قدیمی", status: "active", sort: 0 },
      { id: ROOT_ID, slug: ROOT_PATH, path: ROOT_PATH, name: "توستر اسمگ", status: "active", sort: 1 },
      { id: CHILD_ID, parentId: ROOT_ID, slug: CHILD_SLUG, path: CHILD_PATH, name: "توستر کوچک اسمگ", status: "active", sort: 2 },
      { id: HIDDEN_ID, slug: HIDDEN_PATH, path: HIDDEN_PATH, name: "پنهان", status: "hidden", robots: "index, follow" },
      { id: ARCHIVED_ID, slug: `${PREFIX}-بایگانی`, path: `${PREFIX}-بایگانی`, name: "بایگانی", status: "archived" },
      { id: EMPTY_ID, slug: EMPTY_PATH, path: EMPTY_PATH, name: "خالی", status: "active" },
      { id: MOVABLE_ID, slug: `${PREFIX}-root`, path: `${PREFIX}-root`, name: "ریشهٔ نو", status: "active" },
      {
        id: MOVABLE_CHILD_ID,
        parentId: MOVABLE_ID,
        slug: `${PREFIX}-child`,
        path: `${PREFIX}-root/${PREFIX}-child`,
        name: "شاخهٔ نو",
        status: "active",
      },
    ]);
    await tx.insert(productsTable).values([
      { id: PRODUCT_A, slug: `${PREFIX}-p1`, name: "p1", displayName: "p1", status: "active", visibility: "public", price: 10 },
      { id: PRODUCT_B, slug: `${PREFIX}-p2`, name: "p2", displayName: "p2", status: "draft", visibility: "public", price: 10 },
    ]);
    // PRODUCT_A sits in BOTH the root and its child: the subtree count must still be 1 (distinct).
    await tx.insert(productCategories).values([
      { productId: PRODUCT_A, categoryId: ROOT_ID, isPrimary: true },
      { productId: PRODUCT_A, categoryId: CHILD_ID },
      { productId: PRODUCT_B, categoryId: CHILD_ID },
    ]);
    // Explicit ids leave the serial sequence behind; push it past them so the rows `upsertCategory`
    // creates with a default id cannot collide (the seed's `syncSequence` does the same, the spec).
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('categories', 'id'), (select coalesce(max(id), 1) from categories), true)`,
    );
  }

  it("path normalization", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      for (const variant of [ROOT_PATH, `${ROOT_PATH}/`, `/category/${ROOT_PATH}/`, `category/${ROOT_PATH}`, `//${ROOT_PATH}//`]) {
        expect((await getCategoryByPath(tx, variant))?.id).toBe(ROOT_ID);
      }
      expect((await getCategoryByPath(tx, ` ${CHILD_PATH} `))?.id).toBe(CHILD_ID);
      expect(await getCategoryByPath(tx, "")).toBeNull();
      expect(await getCategoryByPath(tx, "/category/")).toBeNull();
      // rules: the two live 301 paths never resolve to a category page.
      expect(await getCategoryByPath(tx, "بلاگ")).toBeNull();
      expect(await getCategoryByPath(tx, "محصولات-اسمگ")).toBeNull();
    });
  });

  it("hidden noindex", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const hidden = await getCategoryByPath(tx, HIDDEN_PATH);
      expect(hidden?.status).toBe("hidden");
      expect(hidden?.seo.robots).toBe("noindex, follow");
      expect(hidden?.seo.canonical).toBe(`/category/${HIDDEN_PATH}/`);
      // an active row keeps its stored robots verbatim
      const active = await getCategoryByPath(tx, ROOT_PATH);
      expect(active?.seo.robots).toBe("index, follow");
      expect(active?.seo.title).toBe("توستر اسمگ - نامی لوکس");
      expect(active?.seo.description).toBeNull();
      // archived → null; the router consults resolveRedirect
      expect(await getCategoryByPath(tx, `${PREFIX}-بایگانی`)).toBeNull();
    });
  });

  it("empty category served", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const empty = await getCategoryByPath(tx, EMPTY_PATH);
      expect(empty).not.toBeNull();
      expect(empty?.children).toEqual([]);

      // a product filed in both the parent and the child is counted ONCE in the subtree
      const root = await getCategoryByPath(tx, ROOT_PATH);
      expect(root?.children).toEqual([
        { id: CHILD_ID, name: "توستر کوچک اسمگ", path: CHILD_PATH, count: 1 },
      ]);
      expect(root?.parentId).toBeNull();
    });
  });

  it("descendants of leaf", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(await descendantIds(tx, CHILD_ID)).toEqual([CHILD_ID]);
      expect(await descendantIds(tx, ROOT_ID)).toEqual([ROOT_ID, CHILD_ID]);
      // archived rows never enter the closure
      expect(await descendantIds(tx, ARCHIVED_ID)).toEqual([]);
      expect(await descendantIds(tx, 0)).toEqual([]);
      expect(await ancestorIds(tx, CHILD_ID)).toEqual([ROOT_ID]);
      expect(await ancestorIds(tx, ROOT_ID)).toEqual([]);
    });
  });

  it("crumbs order", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      expect(await crumbsFor(tx, CHILD_ID)).toEqual([
        { name: "خانه", href: ROUTES.home },
        { name: "فروشگاه", href: ROUTES.shop },
        { name: "توستر اسمگ", href: categoryUrl(ROOT_PATH) },
        { name: "توستر کوچک اسمگ", href: categoryUrl(CHILD_PATH) },
      ]);
      expect((await getCategoryByPath(tx, CHILD_PATH))?.crumbs).toHaveLength(4);
    });
  });

  it("legacy slug immutable", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const base: CategoryInput = {
        ...inputDefaults,
        id: LEGACY_ID,
        parentId: null,
        slug: `${PREFIX}-legacy`,
        name: "قدیمی",
      };
      // same slug + same parent → a plain edit is allowed
      await expect(upsertCategory(tx, { ...base, name: "قدیمی نو" }, ACTOR)).resolves.toMatchObject({
        id: LEGACY_ID,
      });
      await expectAppError(
        upsertCategory(tx, { ...base, slug: `${PREFIX}-legacy-2` }, ACTOR),
        "CONFLICT",
        "legacy_path_immutable",
      );
      await expectAppError(
        upsertCategory(tx, { ...base, parentId: EMPTY_ID }, ACTOR),
        "CONFLICT",
        "legacy_path_immutable",
      );
    });
  });

  it("new row slug change recomputes the subtree and leaves redirects", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const { tags } = await upsertCategory(
        tx,
        { ...inputDefaults, id: MOVABLE_ID, parentId: null, slug: `${PREFIX}-renamed`, name: "ریشهٔ نو" },
        ACTOR,
      );
      expect(tags).toContain(`category:${MOVABLE_ID}`);
      expect(tags).toEqual(expect.arrayContaining(["nav", "catalog", "sitemap"]));

      const rows = await tx
        .select({ id: categoriesTable.id, path: categoriesTable.path })
        .from(categoriesTable)
        .where(inArray(categoriesTable.id, [MOVABLE_ID, MOVABLE_CHILD_ID]));
      const byId = new Map(rows.map((r) => [r.id, r.path]));
      expect(byId.get(MOVABLE_ID)).toBe(`${PREFIX}-renamed`);
      expect(byId.get(MOVABLE_CHILD_ID)).toBe(`${PREFIX}-renamed/${PREFIX}-child`);

      const redirects = await tx
        .select({ fromPath: redirectsTable.fromPath, toPath: redirectsTable.toPath, code: redirectsTable.code })
        .from(redirectsTable)
        .where(like(redirectsTable.fromPath, `/category/${PREFIX}-%`));
      const map = new Map(redirects.map((r) => [r.fromPath, r.toPath]));
      expect(map.get(`/category/${PREFIX}-root/`)).toBe(`/category/${PREFIX}-renamed/`);
      expect(map.get(`/category/${PREFIX}-root/${PREFIX}-child/`)).toBe(`/category/${PREFIX}-renamed/${PREFIX}-child/`);
      expect(redirects.every((r) => r.code === 301)).toBe(true);

      // the old URL is dead as a category and alive as a 301
      expect(await getCategoryByPath(tx, `${PREFIX}-root`)).toBeNull();
      expect((await getCategoryByPath(tx, `${PREFIX}-renamed`))?.id).toBe(MOVABLE_ID);
    });
  });

  it("sibling slug conflict", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      await expectAppError(
        upsertCategory(tx, { ...inputDefaults, parentId: ROOT_ID, slug: CHILD_SLUG, name: "تکراری" }, ACTOR),
        "CONFLICT",
        "sibling_slug_taken",
      );
      // two ROOT rows with the same slug collide too (UNIQUE(parent_id, slug) NULLS NOT DISTINCT)
      await expectAppError(
        upsertCategory(tx, { ...inputDefaults, parentId: null, slug: EMPTY_PATH, name: "تکراری" }, ACTOR),
        "CONFLICT",
        "sibling_slug_taken",
      );
    });
  });

  it("cycle rejected", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const movable = { ...inputDefaults, id: MOVABLE_ID, slug: `${PREFIX}-root`, name: "ریشهٔ نو" };
      await expectAppError(
        upsertCategory(tx, { ...movable, parentId: MOVABLE_CHILD_ID }, ACTOR),
        "VALIDATION",
        "cycle",
      );
      await expectAppError(upsertCategory(tx, { ...movable, parentId: MOVABLE_ID }, ACTOR), "VALIDATION", "cycle");
      await expectAppError(
        upsertCategory(tx, { ...inputDefaults, parentId: 999_999_999, slug: `${PREFIX}-orphan`, name: "یتیم" }, ACTOR),
        "VALIDATION",
        "unknown_parent",
      );
      await expectAppError(
        upsertCategory(tx, { ...inputDefaults, parentId: null, slug: "a/b", name: "نامعتبر" }, ACTOR),
        "VALIDATION",
        "invalid_slug",
      );
    });
  });

  it("creates a row, sanitizes the description and moves a subtree under a new parent", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const created = await upsertCategory(
        tx,
        {
          ...inputDefaults,
          parentId: ROOT_ID,
          slug: `${PREFIX}-fresh`,
          name: "تازه",
          descriptionHtml: "<p>سلام</p><script>x()</script>",
        },
        ACTOR,
      );
      expect(created.tags).toEqual(
        expect.arrayContaining([`category:${created.id}`, `category:${ROOT_ID}`, "nav", "catalog", "sitemap"]),
      );
      const view = await getCategoryByPath(tx, `${ROOT_PATH}/${PREFIX}-fresh`);
      expect(view?.id).toBe(created.id);
      // the spec - the script tag never reaches the database
      expect(view?.descriptionHtml).not.toContain("script");

      // moving a NEW row under another parent recomputes its path
      await upsertCategory(
        tx,
        { ...inputDefaults, id: MOVABLE_ID, parentId: EMPTY_ID, slug: `${PREFIX}-root`, name: "ریشهٔ نو" },
        ACTOR,
      );
      expect((await getCategoryByPath(tx, `${EMPTY_PATH}/${PREFIX}-root`))?.id).toBe(MOVABLE_ID);
      expect((await getCategoryByPath(tx, `${EMPTY_PATH}/${PREFIX}-root/${PREFIX}-child`))?.id).toBe(MOVABLE_CHILD_ID);
    });
  });

  it("listCategoryTree nests active and hidden rows with subtree counts", async () => {
    await withTestTx(handle.db, async (tx) => {
      await seed(tx);
      const tree = await listCategoryTree(tx);
      const mine = tree.filter((n) => FIXTURE_IDS.includes(n.id));
      const ids = mine.map((n) => n.id);
      expect(ids).toContain(ROOT_ID);
      expect(ids).toContain(HIDDEN_ID);
      // archived rows are never offered as a parent
      expect(ids).not.toContain(ARCHIVED_ID);
      const root = mine.find((n) => n.id === ROOT_ID);
      expect(root?.children.map((c) => c.id)).toEqual([CHILD_ID]);
      expect(root?.count).toBe(1);
      expect(root?.children[0]?.count).toBe(1);
      expect(root?.status).toBe("active");
      expect(mine.find((n) => n.id === EMPTY_ID)?.count).toBe(0);
      expect(mine.find((n) => n.id === HIDDEN_ID)?.status).toBe("hidden");
    });
  });
});
