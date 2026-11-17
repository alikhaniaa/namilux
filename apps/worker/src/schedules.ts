import type { Schedule } from "./scheduler";
export const SCHEDULES: Schedule[] = [
  { type: "reservation.expire", every: 60_000 },
  { type: "order.expire", every: 60_000 },
  { type: "consistency.stock", at: { hour: 3, minute: 0, tz: "Asia/Tehran" } },
  { type: "metrics.rollup", at: { hour: 3, minute: 30, tz: "Asia/Tehran" } },
  { type: "loyalty.expire", at: { hour: 3, minute: 40, tz: "Asia/Tehran" } },
  { type: "loyalty.tiers", at: { hour: 3, minute: 45, tz: "Asia/Tehran" } },
  { type: "backup.report", at: { hour: 4, minute: 30, tz: "Asia/Tehran" } },
  { type: "seo.crawl", at: { hour: 5, minute: 0, tz: "Asia/Tehran" }, payload: { mode: "notfound-digest" } },
  // Last of the nightly chores, after the backup has taken its dump of the table it prunes.
  { type: "jobs.prune", at: { hour: 5, minute: 30, tz: "Asia/Tehran" } },
];
