import { jobs } from "@namilux/core";
import type { JobStatus, JobType } from "@namilux/core";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "system.jobs",
  run: async ({ req }) => {
    const s = new URL(req.url).searchParams;
    const status = s.get("status");
    const type = s.get("type");
    const page = Number(s.get("page"));
    const q: { status?: JobStatus; type?: JobType; page?: number } = {};
    if (status !== null) q.status = status as JobStatus;
    if (type !== null) q.type = type as JobType;
    if (Number.isInteger(page) && page > 0) q.page = page;
    const [list, stats] = await Promise.all([jobs.list(db, q), jobs.stats(db)]);
    return { ...list, stats };
  },
});
