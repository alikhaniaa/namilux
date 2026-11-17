import { checkConsistency, jobs } from "@namilux/core";
import type { Handler } from "../runtime";

export const consistencyStock: Handler = async ({ db, log }) => {
  const { drift } = await checkConsistency(db);
  if (drift.length === 0) {
    log.info({ drift: 0 }, "stock consistency ok");
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  await jobs.enqueue(
    db,
    "telegram.notify",
    { kind: "security.alert", event: "stock.drift", count: drift.length },
    { uniqueKey: `stock.drift:${day}` },
  );
  log.warn({ drift: drift.length }, "stock drift detected (no auto-correction)");
};
