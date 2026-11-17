import { dayKey, getSettings, pruneEvents, rollupDay } from "@namilux/core";
import type { Handler } from "../runtime";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const metricsRollup: Handler = async ({ db, log, job }) => {
  const p = job.payload as { day?: unknown };
  // "Yesterday" in Tehran: dayKey folds the +03:30 offset, so subtracting one day of wall-clock time
  // from now lands on the day that just closed there.
  const day = typeof p.day === "string" && DAY_RE.test(p.day) ? p.day : dayKey(new Date(Date.now() - 86_400_000));
  const { metrics } = await rollupDay(db, day);
  const settings = await getSettings(db);
  const { droppedPartitions } = await pruneEvents(db, settings["analytics.sampling"].retentionMonths, new Date());
  log.info({ day, metrics, pruned: droppedPartitions.length }, "metrics.rollup done");
};
