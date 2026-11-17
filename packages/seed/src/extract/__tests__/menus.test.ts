import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import { ANCHOR_HREF, type LegacyMenuItem, auditLegacyMenuTargets, readLegacyMenus } from "../menus.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "menusJson"));

describe("auditLegacyMenuTargets (pure)", () => {
  const items: LegacyMenuItem[] = [
    { menu: "menu_3", text: "خروج", href: "/my-account/customer-logout/", depth: 1 },
    { menu: "menu_2", text: "لوازم بزرگ اسمگ", href: ANCHOR_HREF, depth: 1 },
    { menu: "menu_0", text: "فروشگاه", href: "/shop/", depth: 1 },
    { menu: "menu_2", text: "رفته", href: "/category/gone/", depth: 1 },
  ];

  it("classifies served, redirect, anchor and missing", () => {
    const audit = auditLegacyMenuTargets(items, new Set(["/shop/"]), [{ from: "/my-account/customer-logout/" }]);
    expect(audit.map((a) => a.resolution)).toEqual(["redirect", "anchor", "served", "missing"]);
  });

  it("missing surfaced with its label so the report can name it", () => {
    const audit = auditLegacyMenuTargets(items, new Set(["/shop/"]), []);
    const missing = audit.filter((a) => a.resolution === "missing");
    expect(missing.map((m) => m.href)).toContain("/category/gone/");
    expect(missing.every((m) => m.text.length > 0)).toBe(true);
  });
});

describe.skipIf(!hasExtract)("real menus.json", () => {
  let items: LegacyMenuItem[];

  beforeAll(async () => {
    items = await readLegacyMenus(dir);
  });

  it("reads four menus", () => {
    const menus = [...new Set(items.map((i) => i.menu))].sort();
    expect(menus).toEqual(["menu_0", "menu_1", "menu_2", "menu_3"]);
    expect(items.filter((i) => i.menu === "menu_0")).toHaveLength(5);
    expect(items.filter((i) => i.menu === "menu_1")).toHaveLength(2);
    expect(items.filter((i) => i.menu === "menu_2")).toHaveLength(44);
    expect(items.filter((i) => i.menu === "menu_3")).toHaveLength(13);
  });

  it("strips nonce query so the fixed redirect can match", () => {
    const logout = items.find((i) => i.href.startsWith("/my-account/customer-logout"));
    expect(logout?.href).toBe("/my-account/customer-logout/");
    const audit = auditLegacyMenuTargets(items, new Set(), [{ from: "/my-account/customer-logout/" }]);
    expect(audit.find((a) => a.href === "/my-account/customer-logout/")?.resolution).toBe("redirect");
  });

  it("anchor classified: the mega-menu headings become /#", () => {
    const anchors = items.filter((i) => i.href === ANCHOR_HREF);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    const audit = auditLegacyMenuTargets(anchors, new Set(), []);
    expect(audit.every((a) => a.resolution === "anchor")).toBe(true);
  });

  it("every non-anchor href is a decoded site-relative path", () => {
    for (const i of items) {
      expect(i.href.startsWith("/")).toBe(true);
      expect(i.href.includes("?")).toBe(false);
      expect(/%[0-9a-f]{2}/i.test(i.href)).toBe(false);
    }
  });

  it("the duplicated mega-menu entries both resolve (no dedupe needed)", () => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.href, (counts.get(i.href) ?? 0) + 1);
    const duplicated = [...counts.entries()].filter(([href, n]) => n > 1 && href !== ANCHOR_HREF);
    const audit = auditLegacyMenuTargets(items, new Set(duplicated.map(([href]) => href)), []);
    for (const [href] of duplicated) {
      expect(audit.filter((a) => a.href === href).every((a) => a.resolution === "served")).toBe(true);
    }
  });
});
