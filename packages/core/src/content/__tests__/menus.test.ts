import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, menus as menusTable } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

// DECISION: ../../audit is owned by another module and not yet built when this was written (its `log` throws); the mock
// is the documented no-op signature so these stay tests of menus.ts.
vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import { MENU_LIMITS, getMenus, isSafeHref, setMenu, validateMenuItems } from "../menus";
import type { MenuItem } from "../menus";
import { isAppError } from "../../errors";
import type { Actor } from "../../types";

/** A syntactically valid ULID (26 Crockford chars) built by construction, never counted by hand. */
const ULID = `01H${"Z".repeat(23)}`;

const actor: Actor = { type: "staff", id: ULID, ip: "127.0.0.1" };

const url = (label: string, href: string): MenuItem => ({ label, href, kind: "url" });

/** Every VALIDATION assertion goes through the AppError code, never through the message. */
function expectValidation(run: () => unknown): void {
  try {
    run();
  } catch (err: unknown) {
    expect(isAppError(err)).toBe(true);
    if (isAppError(err)) expect(err.code).toBe("VALIDATION");
    return;
  }
  throw new Error("expected a VALIDATION AppError");
}

describe("isSafeHref - href hygiene table", () => {
  const table: [string, boolean][] = [
    ["/shop/", true],
    ["/shop/?avail=ready", true],
    ["/category/%d8%aa%d9%88%d8%b3%d8%aa%d8%b1/", true],
    ["https://namilux.ir/shop/", true],
    ["https://wa.me/989121230077", true],
    ["javascript:alert(1)", false],
    ["JavaScript:alert(1)", false],
    ["data:text/html;base64,PHNjcmlwdD4=", false],
    ["http://namilux.ir/x/", false],
    ["//evil.example", false],
    ["/\\evil.example", false],
    ["https:///evil.example", false],
    ["https://", false],
    ["HTTPS://namilux.ir/", false],
    ["/shop/../admin/", false],
    ["/shop /", false],
    ["/shop/\nLocation: x", false],
    ["", false],
    ["shop/", false],
    ["tel:+989121230077", false],
  ];

  it.each(table)("isSafeHref(%j) === %s", (href, expected) => {
    expect(isSafeHref(href)).toBe(expected);
  });

  it("rejects an unsafe href through validateMenuItems as VALIDATION", () => {
    expectValidation(() => validateMenuItems("header", [url("فروشگاه", "javascript:alert(1)")]));
    expectValidation(() => validateMenuItems("header", [url("فروشگاه", "//evil.example")]));
    expectValidation(() => validateMenuItems("header", [url("فروشگاه", "http://namilux.ir/x/")]));
    expect(validateMenuItems("header", [url("فروشگاه", "/shop/?avail=ready")])[0]?.href).toBe(
      "/shop/?avail=ready",
    );
  });
});

describe("validateMenuItems - tabbar exactly four", () => {
  const four = [
    url("خانه", "/"),
    url("فروشگاه", "/shop/"),
    url("علاقه‌مندی‌ها", "/wishlist/"),
    url("سبد", "/cart/"),
  ];

  it("accepts exactly four url items", () => {
    expect(validateMenuItems("tabbar", four)).toHaveLength(4);
  });

  it("rejects three and five", () => {
    expectValidation(() => validateMenuItems("tabbar", four.slice(0, 3)));
    expectValidation(() => validateMenuItems("tabbar", [...four, url("مقایسه", "/compare/")]));
  });

  it("rejects a non-url kind and any child", () => {
    expectValidation(() =>
      validateMenuItems("tabbar", [
        { label: "اسمگ", href: "", kind: "brand", ref: "smeg" },
        ...four.slice(1),
      ]),
    );
    expectValidation(() =>
      validateMenuItems("tabbar", [{ ...four[0], children: [url("زیر", "/x/")] } as MenuItem, ...four.slice(1)]),
    );
  });
});

describe("validateMenuItems - depth limits", () => {
  const nest = (depth: number): MenuItem => {
    let node: MenuItem = url(`سطح ${"آ".repeat(depth)}`, "/shop/");
    for (let i = 1; i < depth; i += 1) node = { ...url("گروه", "/shop/"), children: [node] };
    return node;
  };

  it("drawer accepts depth 3 and rejects depth 4", () => {
    expect(validateMenuItems("drawer", [nest(3)])).toHaveLength(1);
    expectValidation(() => validateMenuItems("drawer", [nest(4)]));
  });

  it("header accepts depth 2 and rejects depth 3", () => {
    expect(validateMenuItems("header", [nest(2)])).toHaveLength(1);
    expectValidation(() => validateMenuItems("header", [nest(3)]));
  });

  it("footer columns are flat", () => {
    expect(MENU_LIMITS.footer_shop.maxDepth).toBe(1);
    expectValidation(() => validateMenuItems("footer_shop", [nest(2)]));
  });

  it("counts every node against maxItems", () => {
    const flat = Array.from({ length: MENU_LIMITS.header.maxItems }, () => url("فروشگاه", "/shop/"));
    expect(validateMenuItems("header", flat)).toHaveLength(MENU_LIMITS.header.maxItems);
    expectValidation(() => validateMenuItems("header", [...flat, url("یکی بیشتر", "/shop/")]));
  });
});

describe("validateMenuItems - label rules", () => {
  it("rejects an exclamation mark and a Latin digit", () => {
    expectValidation(() => validateMenuItems("header", [url("پیشنهاد ویژه!", "/discount/")]));
    expectValidation(() => validateMenuItems("header", [url("کالای 2", "/shop/")]));
  });

  it("rejects an empty or over-long label", () => {
    expectValidation(() => validateMenuItems("header", [url("   ", "/shop/")]));
    expectValidation(() => validateMenuItems("header", [url("آ".repeat(41), "/shop/")]));
  });

  it("accepts Persian digits and applies faZwnj", () => {
    const [item] = validateMenuItems("header", [url("علاقه مندی‌های ۲", "/wishlist/")]);
    expect(item?.label).toContain("‌");
    expect(item?.label).toContain("۲");
  });

  it("caps the badge at 12 characters", () => {
    expect(validateMenuItems("header", [{ ...url("ژورنال", "/blog/"), badge: "جدید" }])[0]?.badge).toBe("جدید");
    expectValidation(() =>
      validateMenuItems("header", [{ ...url("ژورنال", "/blog/"), badge: "آ".repeat(13) }]),
    );
  });
});

describe("validateMenuItems - brand ref normalized", () => {
  it("lowercases a brand ref and recomputes the href", () => {
    const [item] = validateMenuItems("drawer", [{ label: "اسمگ", href: "/old/", kind: "brand", ref: "SMEG" }]);
    expect(item?.ref).toBe("smeg");
    expect(item?.href).toBe("/brand/smeg/");
  });

  it("recomputes collection, category and page hrefs from the ref", () => {
    const items = validateMenuItems("drawer", [
      { label: "قهوه", href: "", kind: "collection", ref: "Coffee-And-Drinks" },
      { label: "توستر", href: "", kind: "category", ref: "/category/توستر-اسمگ/" },
      { label: "گارانتی", href: "", kind: "page", ref: "warranty" },
    ]);
    expect(items[0]?.href).toBe("/collection/coffee-and-drinks/");
    expect(items[1]?.ref).toBe("توستر-اسمگ");
    // the url module owns the encoding contract (lowercase hex + trailing slash, the spec)
    expect(items[1]?.href).toMatch(/^\/category\/%[0-9a-f]{2}/);
    expect(items[1]?.href.endsWith("/")).toBe(true);
    expect(items[2]?.href).toBe("/warranty/");
  });

  it("rejects a non-url kind without a ref", () => {
    expectValidation(() => validateMenuItems("drawer", [{ label: "اسمگ", href: "/brand/smeg/", kind: "brand" }]));
    expectValidation(() =>
      validateMenuItems("drawer", [{ label: "اسمگ", href: "", kind: "brand", ref: "  " }]),
    );
  });
});

describe.skipIf(!hasTestDb())("menus against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("missing key empty - every key defaults to [] and setMenu round-trips", async () => {
    await withTestTx(handle.db, async (tx) => {
      const empty = await getMenus(tx);
      expect(empty).toEqual({ header: [], drawer: [], footer_shop: [], footer_help: [], tabbar: [] });

      const { tags } = await setMenu(tx, "header", [url("فروشگاه", "/shop/"), url("ژورنال", "/blog/")], actor);
      expect(tags).toEqual(["nav", "home"]);

      const after = await getMenus(tx);
      expect(after.header.map((i) => i.href)).toEqual(["/shop/", "/blog/"]);
      // EDGE CASE: a key with no row (footer_help here) stays [].
      expect(after.footer_help).toEqual([]);

      // the second save updates the same row instead of inserting a duplicate key
      await setMenu(tx, "header", [url("فروشگاه", "/shop/")], actor);
      const rows = await tx.select().from(menusTable).where(eq(menusTable.key, "header"));
      expect(rows).toHaveLength(1);
      expect((await getMenus(tx)).header).toHaveLength(1);
    });
  });

  it("drops a stored item whose href is unsafe or whose shape is broken", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(menusTable).values({
        key: "footer_shop",
        itemsJson: [
          { label: "خوب", href: "/shop/", kind: "url" },
          { label: "بد", href: "javascript:alert(1)", kind: "url" },
          { label: "ناقص", href: "/x/", kind: "unknown" },
          "not an object",
        ] as never,
      });
      const menus = await getMenus(tx);
      expect(menus.footer_shop.map((i) => i.label)).toEqual(["خوب"]);
    });
  });

  /**
   * 6 Sep 2026 walkthrough: the seed and the legacy import wrote non-url items with a resolved
   * `href` and no `ref`, but the write side treats `ref` as the authoritative handle. The admin's
   * menu editor loaded such a row, posted it straight back and got «items.N.ref required» - every
   * seeded menu was unsaveable. The read side now recovers the ref from the href.
   */
  it("recovers a missing ref from the stored href so a seeded menu can be saved again", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(menusTable).values({
        key: "footer_shop",
        itemsJson: [
          { label: "اسمگ", href: "/brand/smeg/", kind: "brand" },
          { label: "قهوه و نوشیدنی", href: "/collection/coffee-and-drinks/", kind: "collection" },
          { label: "فروشگاه حضوری", href: "/store/", kind: "page" },
          { label: "فروشگاه", href: "/shop/", kind: "url" },
        ] as never,
      });
      const loaded = await getMenus(tx);
      expect(loaded.footer_shop.map((i) => i.ref)).toEqual(["smeg", "coffee-and-drinks", "store", undefined]);
      // and what the editor loads is exactly what the write side accepts back
      await expect(setMenu(tx, "footer_shop", loaded.footer_shop, actor)).resolves.toBeTruthy();
      expect((await getMenus(tx)).footer_shop.map((i) => i.href)).toEqual([
        "/brand/smeg/",
        "/collection/coffee-and-drinks/",
        "/store/",
        "/shop/",
      ]);
    });
  });

  it("rejects an imageMediaId that is not an image media row", async () => {
    await withTestTx(handle.db, async (tx) => {
      await expect(
        setMenu(
          tx,
          "drawer",
          [{ ...url("اسمگ", "/brand/smeg/"), imageMediaId: ULID } as MenuItem],
          actor,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
