import { JOBS_DEAD_RETENTION_DAYS, JOBS_DONE_RETENTION_DAYS, jobs } from "@namilux/core";
import type { Handler } from "../runtime";

/**
 * Daily housekeeping on the `jobs` table: `done` rows older than a week and `dead` rows older than a
 * month go, in batches, so the delete never holds a long lock while the queue is running.
 *
 * The table had no retention at all - 26,000 finished rows at launch, and order.expire +
 * reservation.expire add 2,880 more every day. The counts are logged because they are the only
 * evidence the job did anything; `capped` says the per-run ceiling was hit and rows remain for
 * tomorrow (the ceiling is 50,000, so a backlog drains in days, not weeks).
 */
export const jobsPrune: Handler = async ({ db, log }) => {
  const result = await jobs.prune(db);
  log.info(
    {
      done: result.done,
      dead: result.dead,
      batches: result.batches,
      capped: result.capped,
      doneOlderThanDays: JOBS_DONE_RETENTION_DAYS,
      deadOlderThanDays: JOBS_DEAD_RETENTION_DAYS,
    },
    "jobs pruned",
  );
};
