import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@/proxy";
import {
  INTERNAL_ROUTES_PATH,
  NOT_FOUND_PATH,
  RESERVED_ROOT_SEGMENTS,
  UNSERVED_ROOT_BASES,
  resolvableKey,
  resetRouteSnapshot,
  resolveRouteStatus,
} from "../route-status";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

/** The route folders of a directory: route groups, dynamic segments and files are not segments. */
const routeFolders = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .filter((name) => !/^[([@_]/.test(name) && !name.includes("."));

describe("resolvableKey", () => {
  it("takes the five database-backed namespaces, trailing slash added and case kept", () => {
    expect(resolvableKey("/product/berghoff-heritage-30pcs-cutlery-set/")).toBe("/product/berghoff-heritage-30pcs-cutlery-set/");
    expect(resolvableKey("/brand/philips")).toBe("/brand/philips/");
    expect(resolvableKey("/collection/eid/")).toBe("/collection/eid/");
    expect(resolvableKey("/category/a/b/c/")).toBe("/category/a/b/c/");
    expect(resolvableKey("/some-old-post/")).toBe("/some-old-post/");
    expect(resolvableKey("/product/Mixed-Case/")).toBe("/product/Mixed-Case/");
  });

  it("also takes a legacy shape that matches no route - its row could never fire otherwise", () => {
    expect(resolvableKey("/product-category/kitchen/")).toBe("/product-category/kitchen/");
    expect(resolvableKey("/product-tag/smeg/deep/")).toBe("/product-tag/smeg/deep/");
  });

  it("decodes the Persian slugs the root namespace and the category tree are full of", () => {
    expect(resolvableKey("/%D8%A2%D8%B4%D9%BE%D8%B2%D8%AE%D8%A7%D9%86%D9%87/")).toBe("/آشپزخانه/");
    expect(resolvableKey("/category/%D8%A2%D8%B4%D9%BE%D8%B2%D8%AE%D8%A7%D9%86%D9%87/")).toBe("/category/آشپزخانه/");
  });

  it("keeps its hands off everything the router already answers correctly", () => {
    for (const path of [
      "/",
      "/shop/",
      "/cart/",
      "/account/orders/",
      "/api/internal/routes/",
      "/healthz/",
      "/robots.txt",
      "/sitemap_index.xml",
      "/product-sitemap1.xml",
      "/search-index.json",
      "/sw.js",
      "/product/a/b/", // wrong arity for the segment
      "/shop/nonsense/",
      "/media/x/y.webp",
    ]) {
      expect(resolvableKey(path), path).toBeNull();
    }
  });

  it("does not mistake a decimal in a slug for a file extension", () => {
    expect(resolvableKey("/product/kf-2.0/")).toBe("/product/kf-2.0/");
    expect(resolvableKey("/nespresso-1.5l/")).toBe("/nespresso-1.5l/");
  });
});

/**
 * The reserved list is the one place this fix can rot: a new top-level route folder that is not
 * listed would be read as a root-namespace slug, found in neither the posts nor the pages table,
 * and answered 404 - a live page taken down. So it is checked against the directories themselves.
 */
describe("RESERVED_ROOT_SEGMENTS", () => {
  it("lists every route folder of app/ and app/(site)/ and every folder in public/", () => {
    const owned = [
      ...routeFolders(`${SRC}app`),
      ...routeFolders(`${SRC}app/(site)`),
      ...routeFolders(`${SRC}../public`),
    ];
    expect(owned.length).toBeGreaterThan(15);
    for (const segment of owned) {
      expect(RESERVED_ROOT_SEGMENTS.has(segment), `/${segment}/ is a route of this app but is not reserved`).toBe(true);
    }
  });

  it("keeps the not-found path outside the route table", () => {
    const segments = NOT_FOUND_PATH.replace(/^\/|\/$/g, "").split("/");
    expect(segments.length).toBeGreaterThan(1);
    expect(RESERVED_ROOT_SEGMENTS.has(segments[0] ?? "")).toBe(false);
    expect(resolvableKey(NOT_FOUND_PATH)).toBeNull();
  });
});

/**
 * The last soft-404 hole r18 left: the bare base of a namespace whose only child is dynamic
 * (`/product/`, `/sitemaps/`, …) is matched by `(site)/[slug]`, renders nothing and answers 200.
 *
 * The set is not trusted - it is DERIVED here from the folders themselves, in both directions, so
 * neither way it can rot is silent:
 *   - a namespace that gains a base `page.tsx` must leave the set (or that live page would 404);
 *   - a namespace added with only a dynamic child must join it (or it is a new soft 404).
 * `servesBase` is the same question Next's router asks - is there a page/route file directly in
 * this folder - and the proxy's own matcher decides which candidates middleware ever sees.
 */
describe("UNSERVED_ROOT_BASES", () => {
  const APP_DIRS = [`${SRC}app`, `${SRC}app/(site)`];
  const ROUTE_FILE_RE = /^(?:page|route|default)\.[jt]sx?$/;

  const servesBase = (segment: string): boolean =>
    APP_DIRS.some((dir) => existsSync(`${dir}/${segment}`) && readdirSync(`${dir}/${segment}`).some((f) => ROUTE_FILE_RE.test(f)));

  /** Middleware never runs for what the matcher excludes (`/media/`, `/fonts/`, …). */
  const seenByProxy = (path: string): boolean => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("is exactly the owned bases the proxy sees and no route file serves", () => {
    const owned = [...routeFolders(`${SRC}app`), ...routeFolders(`${SRC}app/(site)`), ...routeFolders(`${SRC}../public`)];
    const derived = new Set(owned.map((name) => `/${name}/`).filter((base) => seenByProxy(base) && !servesBase(base.slice(1, -1))));
    expect([...derived].sort()).toEqual([...UNSERVED_ROOT_BASES].sort());
  });

  it("never names a base a route file serves - that is how a live page would be killed", () => {
    for (const base of UNSERVED_ROOT_BASES) {
      expect(servesBase(base.slice(1, -1)), `${base} is served by a route file and must not be resolvable`).toBe(false);
    }
  });

  it("names only reserved segments: anything else the general rule already resolves", () => {
    for (const base of UNSERVED_ROOT_BASES) {
      expect(RESERVED_ROOT_SEGMENTS.has(base.slice(1, -1)), base).toBe(true);
    }
  });

  it("hands every base to the oracle, at either spelling of the trailing slash", () => {
    for (const base of UNSERVED_ROOT_BASES) {
      expect(resolvableKey(base), base).toBe(base);
      expect(resolvableKey(base.slice(0, -1)), base).toBe(base);
    }
    // The six the box measured at 200-with-a-404-body, named so the list cannot quietly shrink.
    for (const base of ["/product/", "/brand/", "/collection/", "/category/", "/pay/", "/sitemaps/"]) {
      expect(UNSERVED_ROOT_BASES.has(base), base).toBe(true);
    }
  });

  it("leaves every real arity of those namespaces exactly as it was", () => {
    expect(resolvableKey("/product/dyson-v15/")).toBe("/product/dyson-v15/");
    expect(resolvableKey("/product/a/b/")).toBeNull();
    expect(resolvableKey("/category/a/b/")).toBe("/category/a/b/");
    expect(resolvableKey("/pay/ABC123/")).toBeNull();
    expect(resolvableKey("/api/internal/routes/")).toBeNull();
    expect(resolvableKey("/sitemaps/product-sitemap1.xml")).toBeNull();
    // A page that DOES serve its base is untouched, base and all.
    for (const live of ["/shop/", "/blog/", "/account/", "/healthz/", "/offline/", "/ig/"]) {
      expect(resolvableKey(live), live).toBeNull();
    }
  });
});

describe("resolveRouteStatus", () => {
  const LIVE = ["/", "/shop/", "/product/dyson-v15/"];

  function mockEndpoint(answers: Record<string, unknown>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((input: string) => {
      const url = new URL(input);
      const path = url.searchParams.get("path");
      const body = path === null ? { live: LIVE } : (answers[path] ?? { kind: "missing" });
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  beforeEach(() => {
    resetRouteSnapshot();
    process.env.SITE_ORIGIN = "https://namilux.ir";
    process.env.PORT = "3000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRouteSnapshot();
  });

  it("answers a live path from the snapshot without a second call", async () => {
    const fetchMock = mockEndpoint({});
    await expect(resolveRouteStatus("/product/dyson-v15/", null)).resolves.toEqual({ kind: "live" });
    await expect(resolveRouteStatus("/shop/", null)).resolves.toEqual({ kind: "live" });
    // One call: the snapshot. Neither live path asked a question of its own.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:3000${INTERNAL_ROUTES_PATH}`);
  });

  it("asks once for a path the snapshot does not list, and passes the referrer on", async () => {
    const fetchMock = mockEndpoint({ "/product/gone/": { kind: "redirect", to: "/shop/", code: 301 } });
    await expect(resolveRouteStatus("/product/gone/", "https://google.com/x")).resolves.toEqual({
      kind: "redirect",
      to: "/shop/",
      code: 301,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const init = fetchMock.mock.calls[1]?.[1] as { headers: Record<string, string> };
    expect(init.headers["x-nl-referer"]).toBe("https://google.com/x");
    // The canonical host travels with it or the proxy would 301 its own loopback call.
    expect(init.headers["x-forwarded-host"]).toBe("namilux.ir");
  });

  it("reports a genuinely unknown path missing, and a brand-new one live", async () => {
    mockEndpoint({ "/product/just-published/": { kind: "live" } });
    await expect(resolveRouteStatus("/product/never-existed/", null)).resolves.toEqual({ kind: "missing" });
    await expect(resolveRouteStatus("/product/just-published/", null)).resolves.toEqual({ kind: "live" });
  });

  it("has no opinion when the endpoint cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    await expect(resolveRouteStatus("/product/anything/", null)).resolves.toBeNull();
  });

  it("has no opinion on a malformed answer rather than inventing a 404", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    await expect(resolveRouteStatus("/product/anything/", null)).resolves.toBeNull();
  });
});
