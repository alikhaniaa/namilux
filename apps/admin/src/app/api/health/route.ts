import { jobs } from "@namilux/core";
import { pingDb } from "@namilux/db";
import { adminHandler } from "@/lib/http-handler";
import { db } from "@/lib/db";

export const GET = adminHandler({
  permission: "system.jobs",
  run: async () => {
    let dbOk = false;
    try {
      dbOk = (await pingDb(db)).ok;
    } catch {
      dbOk = false;
    }
    const stats = await jobs.stats(db).catch(() => null);
    return { db: dbOk, jobs: stats, at: new Date().toISOString() };
  },
});
