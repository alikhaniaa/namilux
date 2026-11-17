import { z } from "zod";
import { getSettings, jobs, latestSnapshotRun, sitemapCounts } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";
import { env } from "@/env";

export const GET = adminHandler({
  permission: "seo.write",
  run: async () => {
    const [settings, lastRun, counts] = await Promise.all([getSettings(db), latestSnapshotRun(db), sitemapCounts(db)]);
    return { contract: settings["system.contract"] ?? null, lastRun, sitemap: counts, origin: env.SITE_ORIGIN };
  },
});

export const POST = adminHandler({
  schema: z.object({ origin: z.string().url().optional() }).strict(),
  permission: "seo.write",
  run: async ({ input, staff }) => {
    const day = new Date().toISOString().slice(0, 10);
    const id = await jobs.enqueue(db, "seo.crawl", { mode: "parity", origin: input.origin ?? env.SITE_ORIGIN, requestedBy: staff.id }, { uniqueKey: `seo.crawl:parity:${day}` });
    return { jobId: id };
  },
});
