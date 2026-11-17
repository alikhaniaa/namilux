import { PURGE_ALL_SENTINEL, urlsForTags } from "@namilux/core";
import type { PurgeLookups } from "@namilux/core";
import { brands, categories, collections, eq, products } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Handler } from "../runtime";

function lookupsFor(db: Db): PurgeLookups {
  const one = async <T>(rows: Promise<{ v: T }[]>): Promise<T | null> => {
    const r = await rows;
    return r[0]?.v ?? null;
  };
  return {
    productSlug: (id) => one(db.select({ v: products.slug }).from(products).where(eq(products.id, id)).limit(1)),
    categoryPath: (id) => one(db.select({ v: categories.path }).from(categories).where(eq(categories.id, id)).limit(1)),
    brandSlug: (id) => one(db.select({ v: brands.slug }).from(brands).where(eq(brands.id, id)).limit(1)),
    collectionSlug: (id) => one(db.select({ v: collections.slug }).from(collections).where(eq(collections.id, id)).limit(1)),
  };
}

export const cdnPurge: Handler = async ({ db, drivers, env, log, job }) => {
  const p = job.payload as { tags?: unknown; urls?: unknown };
  const origin = (env.SITE_ORIGIN) ?? "";

  let urls: string[];
  if (Array.isArray(p.urls)) {
    urls = p.urls.filter((u): u is string => typeof u === "string");
  } else if (Array.isArray(p.tags)) {
    const tags = p.tags.filter((t): t is string => typeof t === "string");
    urls = await urlsForTags(tags, lookupsFor(db), origin);
  } else {
    log.warn({ jobId: job.id }, "cdn-purge: payload has neither tags nor urls");
    return;
  }

  if (urls[0] === PURGE_ALL_SENTINEL) {
    const res = await drivers.cdn.purgeAll();
    if (!res.ok) throw new Error(`cdn purge-all failed: ${res.error ?? "unknown"}`);
    log.info({ outcome: "purge-all" }, "cdn purged all");
    return;
  }
  if (urls.length === 0) return;

  const res = await drivers.cdn.purgeUrls(urls);
  if (!res.ok) throw new Error(`cdn purge failed: ${res.error ?? "unknown"}`);
  log.info({ purged: res.purged, driver: drivers.cdn.key }, "cdn purged");
};
