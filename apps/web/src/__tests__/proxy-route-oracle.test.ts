import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_FOUND_PATH, UNSERVED_ROOT_BASES, resetRouteSnapshot } from "@/lib/route-status";
import { proxy } from "@/proxy";

/**
 * The SEO defect of r17 (7 Sep 2026), pinned at the only layer that can still set a status line.
 *
 * Every one of these paths measured 200 with `x-nextjs-postponed: 1` on the box: the partial
 * prerender flushes a route's fallback shell before the segment can read the `redirects` table, so
 * `permanentRedirect()` sent no Location and `notFound()` sent no 404 - 182 rows of redirect, 96 of
 * them written that day by the catalogue reduction, were all soft 404s.
 */
const LIVE = ["/", "/shop/", "/product/dyson-v15/", "/brand/dyson/"];

const REDIRECTS: Record<string, unknown> = {
  "/product/berghoff-heritage-30pcs-cutlery-set/": { kind: "redirect", to: "/shop/", code: 301 },
  "/brand/philips/": { kind: "redirect", to: "/shop/", code: 301 },
  "/locations-kml-replacement/": { kind: "redirect", to: "", code: 410 },
  // The oracle is asked in decoded form; the row's target comes back percent-encoded.
  "/category/بلاگ/": { kind: "redirect", to: "/blog/", code: 301 },
};

const NOT_FOUND_HTML = '<html lang="fa" dir="rtl"><body><span>۴۰۴</span></body></html>';

function mockEndpoint(rows: Record<string, unknown> = REDIRECTS, live: readonly string[] = LIVE): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = new URL(input);
      // The app's own 404 page, read over loopback and returned verbatim by the proxy.
      if (url.pathname === NOT_FOUND_PATH) return Promise.resolve(new Response(NOT_FOUND_HTML, { status: 404 }));
      const path = url.searchParams.get("path");
      if (path === null) return Promise.resolve(new Response(JSON.stringify({ live }), { status: 200 }));
      const body = rows[path] ?? (live.includes(path) ? { kind: "live" } : { kind: "missing" });
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

const get = (path: string): NextRequest => new NextRequest(`https://namilux.ir${path}`, { method: "GET" });

beforeEach(() => {
  resetRouteSnapshot();
  mockEndpoint();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouteSnapshot();
});

describe("proxy - the redirects table answers with a status line", () => {
  it("301s an archived product to the row's target, with a Location header", async () => {
    const res = await proxy(get("/product/berghoff-heritage-30pcs-cutlery-set/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://namilux.ir/shop/");
  });

  it("301s a retired brand the same way", async () => {
    const res = await proxy(get("/brand/philips/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://namilux.ir/shop/");
  });

  it("carries a Persian legacy category path through encoded", async () => {
    const res = await proxy(get("/category/%d8%a8%d9%84%d8%a7%da%af/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://namilux.ir/blog/");
  });

  it("answers a 410 row with 410 and no Location", async () => {
    const res = await proxy(get("/locations-kml-replacement/"));
    expect(res.status).toBe(410);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy - an unknown path is a hard 404", () => {
  it("answers a slug that never existed with 404 and the Persian page", async () => {
    const res = await proxy(get("/product/this-slug-never-existed-at-all/"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toContain("۴۰۴");
  });

  it("does the same for the root namespace", async () => {
    expect((await proxy(get("/totally-random-path-xyz/"))).status).toBe(404);
  });

  it("keeps the shopper's URL - a 404 is never a redirect", async () => {
    const res = await proxy(get("/totally-random-path-xyz/"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("reads the not-found page once and holds it for the life of the process", async () => {
    await proxy(get("/totally-random-path-xyz/"));
    await proxy(get("/product/another-dead-one/"));
    const urls = vi.mocked(fetch).mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : ""));
    const pages = urls.filter((u) => u.includes(NOT_FOUND_PATH));
    expect(pages).toHaveLength(1);
  });

  it("leaves a client-side navigation alone - its answer is a flight payload, not HTML", async () => {
    const rsc = new NextRequest("https://namilux.ir/totally-random-path-xyz/", { method: "GET", headers: { rsc: "1" } });
    const res = await proxy(rsc);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("serves the request untouched when the not-found page cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input);
        if (url.pathname === NOT_FOUND_PATH) return Promise.resolve(new Response("boom", { status: 500 }));
        const path = url.searchParams.get("path");
        const body = path === null ? { live: LIVE } : { kind: "missing" };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    const res = await proxy(get("/product/never-existed/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

/**
 * The hole r18 left. `app/(site)/product` holds only `[slug]`, so nothing answers `/product/`
 * itself - `(site)/[slug]` matches it with slug "product", finds no post or page and streams the
 * not-found body into a 200 that was already flushed. Same for `/brand/`, `/collection/`,
 * `/category/`, `/pay/`, `/sitemaps/`, `/api/` and `/splash/`. The answer is still the oracle's, so
 * a base the redirects table owns 301s and a base a content page occupies keeps its 200.
 */
describe("proxy - the bare base of a namespace nothing serves", () => {
  it("answers every one of them 404, with the app's own Persian page", async () => {
    for (const base of UNSERVED_ROOT_BASES) {
      const res = await proxy(get(base));
      expect(res.status, base).toBe(404);
      expect(res.headers.get("content-type"), base).toBe("text/html; charset=utf-8");
      expect(res.headers.get("location"), base).toBeNull();
      expect(await res.text(), base).toContain("۴۰۴");
    }
  });

  it("answers the slashless spelling the same way", async () => {
    expect((await proxy(get("/product"))).status).toBe(404);
    expect((await proxy(get("/sitemaps"))).status).toBe(404);
  });

  it("301s a base the redirects table owns instead of 404ing it", async () => {
    mockEndpoint({ ...REDIRECTS, "/collection/": { kind: "redirect", to: "/shop/", code: 301 } });
    const res = await proxy(get("/collection/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://namilux.ir/shop/");
  });

  it("leaves a base a content page occupies at 200 - a live page is never killed", async () => {
    // `loadLiveRoutes()` lists every root page as `/<slug>/`, so a page slugged "pay" lands here.
    mockEndpoint(REDIRECTS, [...LIVE, "/pay/"]);
    const res = await proxy(get("/pay/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves every base exactly as it is today when the oracle cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    for (const base of UNSERVED_ROOT_BASES) {
      const res = await proxy(get(base));
      expect(res.status, base).toBe(200);
      expect(res.headers.get("x-middleware-next"), base).toBe("1");
    }
  });

  it("never asks about a base whose folder has a page of its own", async () => {
    for (const base of ["/shop/", "/blog/", "/cart/", "/account/", "/ig/", "/offline/", "/healthz/"]) {
      const res = await proxy(get(base));
      expect(res.status, base).toBe(200);
      expect(res.headers.get("x-middleware-next"), base).toBe("1");
    }
    // Not one of them cost a question: they never reach the oracle at all.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("proxy - a live path is untouched and still cacheable", () => {
  it("passes a prerendered product through with the edge cache policy", async () => {
    const res = await proxy(get("/product/dyson-v15/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("cache-control")).toContain("s-maxage=300");
  });

  it("passes home and a listing through", async () => {
    for (const path of ["/", "/shop/", "/brand/dyson/"]) {
      const res = await proxy(get(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
    }
  });

  it("never asks about a live path more than the one snapshot call", async () => {
    await proxy(get("/product/dyson-v15/"));
    await proxy(get("/brand/dyson/"));
    await proxy(get("/shop/"));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("serves everything as it does today when the oracle cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))));
    const res = await proxy(get("/product/this-slug-never-existed-at-all/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy - the rewrites it already did keep working exactly as they did", () => {
  it("still 301s the legacy my-account shape without consulting the oracle", async () => {
    const res = await proxy(get("/my-account/orders/"));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://namilux.ir/account/orders/");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("still 301s legacy pagination and /checkout/", async () => {
    expect((await proxy(get("/shop/page/3/"))).headers.get("location")).toBe("https://namilux.ir/shop/?page=3");
    expect((await proxy(get("/checkout/"))).headers.get("location")).toBe("https://namilux.ir/billing/");
  });

  it("still answers /locations.kml with 410", async () => {
    expect((await proxy(get("/locations.kml"))).status).toBe(410);
  });

  it("still refuses an oversized segment and a non-page method", async () => {
    expect((await proxy(get(`/product/${"x".repeat(300)}/`))).status).toBe(404);
    const post = new NextRequest("https://namilux.ir/shop/", { method: "POST" });
    expect((await proxy(post)).status).toBe(405);
  });
});
