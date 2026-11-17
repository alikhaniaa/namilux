import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactModule from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavCollection, NavData } from "@namilux/core";
import { NavDrawer } from "../NavDrawer";

const state = vi.hoisted((): { expanded: string | null } => ({ expanded: null }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, useState: (initial: unknown) => [initial === null ? state.expanded : initial, vi.fn()] };
});
vi.mock("next/link", () => ({ default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/state/providers", () => ({ useUser: () => null }));
vi.mock("@/components/state/cart-store", () => ({ useCart: () => ({ count: 0 }) }));
vi.mock("@/components/state/wishlist-store", () => ({ useWishlist: () => ({ count: 0 }) }));
vi.mock("../ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../CompareControl", () => ({ CompareControl: () => null }));
vi.mock("@/components/ui/Drawer", () => ({ Drawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

const groups: NavCollection[] = ["coffee", "cooking", "cleaning", "beauty"].map((slug, i) => ({
  slug, name: `گروه ${String(i + 1)}`, count: 12, href: `/collection/${slug}/`, image: null,
  children: i === 0 ? Array.from({ length: 8 }, (_, n) => ({ slug: `child-${String(n)}`, name: `زیرگروه ${String(n)}`, count: 2, href: `/collection/child-${String(n)}/` })) : [],
}));

const nav: NavData = {
  menus: { header: [], drawer: [], footer_shop: [], footer_help: [], tabbar: [] },
  brands: [{ slug: "custom-brand", name: "برند آزمون", nameEn: "Custom", count: 4, image: null, href: "/brand/custom-brand/" }],
  collections: groups,
  counts: { products: 48, buyable: 40, onSale: 2, brands: 1 },
  generatedAt: "2026-10-08T00:00:00.000Z",
};

beforeEach(() => { state.expanded = null; });

describe("mobile catalogue navigation", () => {
  it("uses the real collection and brand destinations before secondary account links", () => {
    const html = renderToStaticMarkup(<NavDrawer nav={nav} open />);
    for (const group of groups) expect(html).toContain(group.name);
    expect(html).toContain('href="/collection/cooking/"');
    expect(html).toContain('href="/brand/custom-brand/"');
    expect(html.indexOf("menu__categories")).toBeLessThan(html.indexOf("menu__secondary"));
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("puts an expanded group's links after its own tile row and preserves view-all", () => {
    state.expanded = "coffee";
    const html = renderToStaticMarkup(<NavDrawer nav={nav} open />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('href="/collection/child-0/"');
    expect(html).toContain('href="/collection/child-5/"');
    expect(html).not.toContain('href="/collection/child-6/"');
    expect(html).toContain('href="/collection/coffee/"');
    expect(html.indexOf('href="/collection/child-0/"')).toBeLessThan(html.indexOf('href="/collection/cleaning/"'));
    const controlledId = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controlledId).toBeDefined();
    expect(html).toContain(`id="${controlledId ?? ""}"`);
  });
});
