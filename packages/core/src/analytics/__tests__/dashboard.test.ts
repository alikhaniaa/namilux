import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { SETTINGS } from "../../__tests__/support/fixtures";
import { WORKER_HEARTBEAT_STALE_SEC } from "../../constants";
import { jobs } from "../../jobs";
import { dashboard, funnel, uaClasses } from "../dashboard";
import { analytics } from "../record";

const SAMPLING = SETTINGS["analytics.sampling"];
const CTX = { ip: "1.2.3.4", ua: "Mozilla/5.0 (Linux; Android 14) Mobile", sampling: SAMPLING };

describe.skipIf(!hasTestDb())("dashboard", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
    await truncateAll(handle.db); // counts are absolute: start from an empty events table
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  it("returns zeros on an empty database", async () => {
    const d = await dashboard(handle.db, "today", { now: new Date(), smsDailyBudget: 500_000 });
    expect(d.revenue).toEqual({ today: 0, d7: 0, d30: 0 });
    expect(d.aov).toBe(0);
    expect(d.conversion).toBe(0);
    expect(d.topProducts).toEqual([]);
    expect(d.lowStock).toEqual([]);
    expect(d.inbox).toEqual({ concierge: 0, questions: 0, reviews: 0, returns: 0, contact: 0 });
    expect(d.otp).toEqual({ sendsToday: 0, smsSpendToday: 0, budget: 500_000 });
    expect(d.jobs).toEqual({ failed: 0, dead: 0, queued: 0 });
    expect(d.workerHeartbeatAt).toBeNull();
    expect(d.lastBackupAt).toBeNull();
  });

  it("funnel rates are step over previous step", async () => {
    const now = new Date();
    const sids = ["a1b2c3d4e5f60718", "b1b2c3d4e5f60718", "c1b2c3d4e5f60718", "d1b2c3d4e5f60718"];
    for (const s of sids) await analytics.record(handle.db, { t: "pv", p: "/", s, ua: "mobile" }, { ...CTX, now });
    for (const s of sids.slice(0, 2)) await analytics.record(handle.db, { t: "pv", p: "/product/x/", pid: 1, s, ua: "mobile" }, { ...CTX, now });
    await analytics.record(handle.db, { t: "atc", p: "/product/x/", pid: 1, s: sids[0] ?? "", ua: "mobile" }, { ...CTX, now });
    await analytics.record(handle.db, { t: "checkout_step", p: "/billing/", s: sids[0] ?? "", ua: "mobile", x: { step: 1 } }, { ...CTX, now });
    await analytics.record(handle.db, { t: "purchase", p: "/billing/result/", s: sids[0] ?? "", ua: "mobile" }, { ...CTX, now });
    const f = await funnel(handle.db, "today");
    const byStep = Object.fromEntries(f.map((s) => [s.step, s]));
    // 6 pageviews in total (4 home + 2 pdp); every rate is relative to the first step
    expect(byStep["pv"]?.count).toBe(6);
    expect(byStep["pv"]?.rate).toBe(1);
    expect(byStep["pdp"]?.count).toBe(2);
    expect(byStep["pdp"]?.rate).toBeCloseTo(2 / 6, 3);
    expect(byStep["atc"]?.count).toBe(1);
    expect(byStep["checkout"]?.count).toBe(1);
    expect(byStep["purchase"]?.count).toBe(1);
    expect(byStep["purchase"]?.rate).toBeCloseTo(1 / 6, 3);
    const ua = await uaClasses(handle.db, "today");
    expect(ua.mobile).toBe(9);
  });

  it("sms budget percentage", async () => {
    const budget: number = 200_000;
    const d = await dashboard(handle.db, "today", { now: new Date(), smsDailyBudget: budget });
    expect(d.otp.budget).toBe(budget);
    const percent = budget === 0 ? 0 : Math.round((d.otp.smsSpendToday / budget) * 100);
    expect(percent).toBe(0);
    expect(d.otp.smsSpendToday).toBeLessThanOrEqual(budget);
  });

  it("worker is flagged stale after WORKER_HEARTBEAT_STALE_SEC", async () => {
    expect(WORKER_HEARTBEAT_STALE_SEC).toBe(180);
    const isStale = (at: string | null, now: Date): boolean => at === null || now.getTime() - new Date(at).getTime() > WORKER_HEARTBEAT_STALE_SEC * 1000;
    const before = await dashboard(handle.db, "today", { now: new Date(), smsDailyBudget: 1 });
    expect(isStale(before.workerHeartbeatAt, new Date())).toBe(true); // never seen → stale
    await jobs.heartbeat(handle.db, "worker-test", { pid: 1 });
    const after = await dashboard(handle.db, "today", { now: new Date(), smsDailyBudget: 1 });
    expect(after.workerHeartbeatAt).not.toBeNull();
    expect(isStale(after.workerHeartbeatAt, new Date())).toBe(false);
    expect(isStale(after.workerHeartbeatAt, new Date(Date.now() + (WORKER_HEARTBEAT_STALE_SEC + 1) * 1000))).toBe(true);
  });
});
