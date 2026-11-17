import { ROBOTS_DISALLOW, SITEMAP_CHILDREN } from "@namilux/core";
import type { MetadataRoute } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

const SITE_ORIGIN = "https://namilux.ir";
const INSTALMENTS_ORIGIN = "https://namilux2.ir";

/**
 * The SEO routes read the channel at module load (lib/channel.ts ← `@/env`), so each case loads them
 * again against a mocked env - the shape lib/__tests__/http-handler.test.ts uses, because the real
 * schema needs secrets no test process carries. `@/lib/db` is mocked to a client that throws: a
 * sitemap the site does not publish must be refused without ever reaching the catalogue.
 */
async function withMode<T>(mode: "main" | "instalments", fn: () => Promise<T>): Promise<T> {
  vi.resetModules();
  const origin = mode === "main" ? SITE_ORIGIN : INSTALMENTS_ORIGIN;
  vi.doMock("@/env", () => ({ env: { SITE_MODE: mode, SITE_ORIGIN: origin } }));
  vi.doMock("@/lib/db", () => ({
    db: {
      select: () => {
        throw new Error("a sitemap this site does not publish must not be built");
      },
    },
  }));
  try {
    return await fn();
  } finally {
    vi.doUnmock("@/env");
    vi.doUnmock("@/lib/db");
    vi.resetModules();
  }
}

/** Only the three fields these cases read; `| undefined` because `exactOptionalPropertyTypes` is on. */
type RobotsRule = {
  userAgent?: string | string[] | undefined;
  allow?: string | string[] | undefined;
  disallow?: string | string[] | undefined;
};

const firstRule = (robots: MetadataRoute.Robots): RobotsRule => {
  const rules = robots.rules;
  return (Array.isArray(rules) ? rules[0] : rules) ?? {};
};

afterEach(() => {
  vi.resetModules();
});

describe("robots.txt by channel", () => {
  it("the main site advertises its sitemap and disallows only the private paths", async () => {
    await withMode("main", async () => {
      const robots = (await import("../robots")).default();
      const rule = firstRule(robots);
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toStrictEqual([...ROBOTS_DISALLOW]);
      expect(robots.sitemap).toBe(`${SITE_ORIGIN}/sitemap_index.xml`);
      expect(robots.host).toBe(SITE_ORIGIN);
    });
  });

});

describe("sitemaps by channel", () => {
  it("the main site publishes all sitemap children", async () => {
    const main = await withMode("main", async () => {
      const { publishesSitemap } = await import("@/server/sitemap-channel");
      return SITEMAP_CHILDREN.filter((name) => publishesSitemap(name));
    });
    expect(main).toStrictEqual([...SITEMAP_CHILDREN]);

  });

  it("an unknown child name is still a 404 on the main site", async () => {
    await withMode("main", async () => {
      const { GET } = await import("../sitemaps/[name]/route");
      const req = new Request(`${SITE_ORIGIN}/sitemaps/not-a-sitemap.xml`);
      const res = await GET(req, { params: Promise.resolve({ name: "not-a-sitemap" }) });
      expect(res.status).toBe(404);
    });
  });
});
