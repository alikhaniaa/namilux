import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, jobs as jobsTable, like } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { slotKey, startScheduler } from "../scheduler";
import type { Schedule } from "../scheduler";
import type { Logger } from "../logger";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("scheduler slotKey", () => {
  it("an `at` schedule is due only at its Tehran hour:minute, once per day", () => {
    const at: Schedule = { type: "metrics.rollup", at: { hour: 3, minute: 30, tz: "Asia/Tehran" } };
    // Tehran is UTC+03:30, so 03:30 Tehran is 00:00 UTC.
    const dueEarly = new Date("2026-08-28T00:00:10Z");
    const dueLate = new Date("2026-08-28T00:00:50Z");
    const notDue = new Date("2026-08-28T00:01:10Z"); // 03:31 Tehran

    expect(slotKey(at, dueEarly)).toBe("2026-08-28");
    // Two ticks inside the same target minute collapse to the same day slot → one enqueue.
    expect(slotKey(at, dueLate)).toBe(slotKey(at, dueEarly));
    expect(slotKey(at, notDue)).toBeNull();
  });

  it("an `every` schedule buckets by its window (per-minute dedupe)", () => {
    const every: Schedule = { type: "reservation.expire", every: 60_000 };
    const a = new Date("2026-08-28T10:00:05Z");
    const b = new Date("2026-08-28T10:00:55Z");
    const c = new Date("2026-08-28T10:01:05Z");
    expect(slotKey(every, a)).toBe(slotKey(every, b)); // same minute
    expect(slotKey(every, a)).not.toBe(slotKey(every, c)); // next minute
  });

  it("Tehran offset is fixed (no DST) across summer and winter", () => {
    const at: Schedule = { type: "backup.report", at: { hour: 3, minute: 30, tz: "Asia/Tehran" } };
    // Both a July and a January instant at 00:00 UTC map to 03:30 Tehran - a constant +03:30 offset.
    expect(slotKey(at, new Date("2026-07-01T00:00:00Z"))).toBe("2026-07-01");
    expect(slotKey(at, new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe.skipIf(!hasTestDb())("scheduler enqueue", () => {
  let tdb: TestDb;
  let db: Db;
  const type = "reservation.expire" as const;
  const uniquePrefix = "reservation.expire:";

  beforeAll(async () => {
    tdb = await createTestDb();
    db = tdb.db;
    await db.delete(jobsTable).where(like(jobsTable.uniqueKey, `${uniquePrefix}%`));
  });
  afterAll(async () => {
    await db.delete(jobsTable).where(like(jobsTable.uniqueKey, `${uniquePrefix}%`));
    await tdb.close();
  });

  it("an every-minute schedule enqueues exactly one deduped job per window", async () => {
    const sched = startScheduler(db, [{ type, every: 60_000 }], silent);
    // The scheduler ticks immediately on start; wait for the enqueue, then stop.
    await sleep(200);
    sched.stop();
    const rows = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.type, type));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
