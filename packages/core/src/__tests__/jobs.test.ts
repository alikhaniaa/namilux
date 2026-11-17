import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, auditLog, eq, jobs as jobsTable, like, lt } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { backoffMinutes, jobs } from "../jobs";
import { JOB_BACKOFF_MIN } from "../constants";
import type { JobType } from "../constants";
import { ulid } from "../ids";
import type { Actor } from "../types";

const RUN = ulid().slice(-10);

/**
 * `jobs.type` is a `text` column and `claim()` filters on the caller's explicit list, so a private
 * type per test isolates it completely from rows any other file (or a previous run) left behind.
 */
const testType = (name: string): JobType => `test.jobs.${name}.${RUN}` as JobType;
const TYPE_PREFIX = "test.jobs.%";

const ACTOR: Actor = { type: "staff", id: `staff-${RUN}` };
const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

describe("jobs queue", () => {
  it("backoffMinutes follows 1/5/25/125 then 125", () => {
    expect([1, 2, 3, 4, 5, 6, 99].map((n) => backoffMinutes(n))).toEqual([1, 5, 25, 125, 125, 125, 125]);
    expect(JOB_BACKOFF_MIN).toEqual([1, 5, 25, 125]);
    // Out-of-range input degrades to the first step rather than throwing inside a worker loop.
    expect(backoffMinutes(0)).toBe(1);
    expect(backoffMinutes(-3)).toBe(1);
    expect(backoffMinutes(Number.NaN)).toBe(1);
  });

  it("rejects a payload over 64 KB before touching the database", async () => {
    const noDb = {} as unknown as Db;
    await expect(jobs.enqueue(noDb, "sms.send", { blob: "x".repeat(70_000) })).rejects.toThrow(RangeError);
  });
});

describe.skipIf(!hasTestDb())("jobs queue (integration)", () => {
  let testDb: TestDb;
  let other: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
    other = await createTestDb({ migrate: false });
  });

  afterAll(async () => {
    // The SKIP LOCKED case is the only one that commits: clean it up by type prefix, never TRUNCATE.
    await testDb.db.delete(jobsTable).where(like(jobsTable.type, TYPE_PREFIX));
    await other.close();
    await testDb.close();
  });

  it("claim respects run_at and priority order", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("order");
      const now = new Date();
      const older = await jobs.enqueue(tx, type, { n: "older" }, { runAt: minutesAgo(10) });
      const recent = await jobs.enqueue(tx, type, { n: "recent" }, { runAt: minutesAgo(5) });
      const urgent = await jobs.enqueue(tx, type, { n: "urgent" }, { runAt: minutesAgo(1), priority: 5 });
      const future = await jobs.enqueue(tx, type, { n: "future" }, { runAt: new Date(Date.now() + 600_000) });

      const first = await jobs.claim(tx, "w1", [type], now);
      expect(first?.id).toBe(urgent);
      expect(first?.status).toBe("running");
      expect(first?.lockedBy).toBe("w1");
      expect(first?.lockedAt).not.toBeNull();
      // The reserved priority key never reaches a handler.
      expect(first?.payload).toEqual({ n: "urgent" });

      expect((await jobs.claim(tx, "w1", [type], now))?.id).toBe(older);
      expect((await jobs.claim(tx, "w1", [type], now))?.id).toBe(recent);
      // `future` is not due yet, so the queue reports empty.
      expect(await jobs.claim(tx, "w1", [type], now)).toBeNull();
      expect(await jobs.claim(tx, "w1", [], now)).toBeNull();

      const stillQueued = await tx.select().from(jobsTable).where(eq(jobsTable.id, future));
      expect(stillQueued[0]?.status).toBe("queued");
    });
  });

  it("two concurrent claimers never receive the same job (SKIP LOCKED)", async () => {
    const type = testType("skiplocked");
    // Committed on purpose: two sessions cannot see each other's uncommitted rows.
    const a = await jobs.enqueue(testDb.db, type, { n: 1 }, { runAt: minutesAgo(1) });
    const b = await jobs.enqueue(testDb.db, type, { n: 2 }, { runAt: minutesAgo(1) });
    const now = new Date();

    const [first, second] = await Promise.all([
      jobs.claim(testDb.db, "worker-a", [type], now),
      jobs.claim(other.db, "worker-b", [type], now),
    ]);
    const claimed = [first?.id, second?.id].filter((id): id is string => id !== undefined);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed)).toEqual(new Set([a, b]));

    expect(await jobs.claim(testDb.db, "worker-a", [type], now)).toBeNull();

    await jobs.complete(testDb.db, a);
    const done = await testDb.db.select().from(jobsTable).where(eq(jobsTable.id, a));
    expect(done[0]?.status).toBe("done");
    expect(done[0]?.finishedAt).not.toBeNull();
    expect(done[0]?.lockedBy).toBeNull();
  });

  it("job becomes dead after max_attempts", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("dead");
      const id = await jobs.enqueue(tx, type, { n: 1 }, { runAt: minutesAgo(1), maxAttempts: 3 });
      await jobs.claim(tx, "w1", [type], new Date());

      expect(await jobs.fail(tx, id, "boom 1")).toBe("retry");
      const first = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(first?.attempts).toBe(1);
      expect(first?.status).toBe("queued");
      expect(first?.lockedBy).toBeNull();
      expect(first?.lastError).toBe("boom 1");
      const delayMin = ((first?.runAt.getTime() ?? 0) - Date.now()) / 60_000;
      expect(delayMin).toBeGreaterThan(0.5);
      expect(delayMin).toBeLessThanOrEqual(1);

      expect(await jobs.fail(tx, id, "boom 2")).toBe("retry");
      const second = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(second?.attempts).toBe(2);
      expect(((second?.runAt.getTime() ?? 0) - Date.now()) / 60_000).toBeLessThanOrEqual(5);

      expect(await jobs.fail(tx, id, "boom 3")).toBe("dead");
      const dead = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(dead?.status).toBe("dead");
      expect(dead?.attempts).toBe(3);
      expect(dead?.finishedAt).not.toBeNull();

      // EDGE CASE: fail() on a job already dead is a no-op.
      expect(await jobs.fail(tx, id, "boom 4")).toBe("dead");
      const unchanged = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(unchanged?.attempts).toBe(3);
      expect(unchanged?.lastError).toBe("boom 3");
      expect(await jobs.fail(tx, `missing-${RUN}`, "boom")).toBe("dead");
    });
  });

  it("uniqueKey dedupes to the existing row regardless of status (INSERT-only, no recycle)", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("unique");
      const uniqueKey = `bis:${RUN}:1`;
      const first = await jobs.enqueue(tx, type, { n: 1 }, { uniqueKey, runAt: minutesAgo(1) });
      const again = await jobs.enqueue(tx, type, { n: 2 }, { uniqueKey, runAt: minutesAgo(1) });
      expect(again).toBe(first);

      const rows = await tx.select().from(jobsTable).where(eq(jobsTable.uniqueKey, uniqueKey));
      expect(rows).toHaveLength(1);
      // The queued job was left alone: the second payload never overwrote the first.
      expect(rows[0]?.payloadJson).toEqual({ n: 1 });

      // Running is deduped too.
      await jobs.claim(tx, "w1", [type], new Date());
      expect(await jobs.enqueue(tx, type, { n: 3 }, { uniqueKey })).toBe(first);
      const running = await tx.select().from(jobsTable).where(eq(jobsTable.uniqueKey, uniqueKey));
      expect(running[0]?.status).toBe("running");

      // Once the work is done the key still dedupes to that row (DO NOTHING): no recycle, no new
      // job, and - crucially - no UPDATE on jobs, so an INSERT-only role (nl_web) can enqueue safely.
      // See the DECISION note on jobs.enqueue.
      await jobs.complete(tx, first);
      const deduped = await jobs.enqueue(tx, type, { n: 4 }, { uniqueKey, runAt: minutesAgo(1) });
      expect(deduped).toBe(first);
      const after = await tx.select().from(jobsTable).where(eq(jobsTable.uniqueKey, uniqueKey));
      expect(after).toHaveLength(1);
      // The completed row is untouched - still done, original payload, not re-queued.
      expect(after[0]?.status).toBe("done");
      expect(after[0]?.finishedAt).not.toBeNull();
      expect(after[0]?.payloadJson).toEqual({ n: 1 });
      // Nothing is runnable: the key stays claimed by its finished row.
      expect(await jobs.claim(tx, "w2", [type], new Date())).toBeNull();
    });
  });

  it("requeueStale recovers a job locked by a crashed worker", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("stale");
      const id = await jobs.enqueue(tx, type, { n: 1 }, { runAt: minutesAgo(1) });
      await jobs.claim(tx, "crashed", [type], new Date());
      await tx.update(jobsTable).set({ lockedAt: minutesAgo(30) }).where(eq(jobsTable.id, id));

      const requeued = await jobs.requeueStale(tx, 10);
      expect(requeued).toBeGreaterThanOrEqual(1);
      const row = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(row?.status).toBe("queued");
      expect(row?.lockedBy).toBeNull();
      expect(row?.lockedAt).toBeNull();
      expect((await jobs.claim(tx, "w2", [type], new Date()))?.id).toBe(id);
    });
  });

  it("does not requeue an old claim while its handler is still executing", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("active-stale");
      const id = await jobs.enqueue(tx, type, {}, { runAt: minutesAgo(1) });
      await jobs.claim(tx, "working", [type], new Date());
      await tx.update(jobsTable).set({ lockedAt: minutesAgo(30) }).where(eq(jobsTable.id, id));
      await jobs.requeueStale(tx, 10, [id]);
      const row = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(row?.status).toBe("running");
      expect(await jobs.claim(tx, "other", [type], new Date())).toBeNull();
    });
  });

  it("heartbeat upserts one row per workerId", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const workerId = `test-worker-${RUN}`;
      await jobs.heartbeat(tx, workerId, { pid: 1 });
      await jobs.heartbeat(tx, workerId, { pid: 2 });

      const rows = await tx.select().from(jobsTable).where(eq(jobsTable.uniqueKey, workerId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("worker.heartbeat");
      // Stored terminal so the heartbeat never enters the queue.
      expect(rows[0]?.status).toBe("done");
      expect(rows[0]?.finishedAt).not.toBeNull();
      const payload = rows[0]?.payloadJson as { pid?: number; workerId?: string; ts?: string };
      expect(payload.pid).toBe(2);
      expect(payload.workerId).toBe(workerId);
      expect(typeof payload.ts).toBe("string");
    });
  });

  it("list, stats and retry serve the admin jobs screen", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("admin");
      const id = await jobs.enqueue(tx, type, { n: 1 }, { runAt: minutesAgo(1), maxAttempts: 1 });

      const page = await jobs.list(tx, { type, page: 1 });
      expect(page.total).toBe(1);
      expect(page.pageSize).toBe(50);
      expect(page.items[0]?.id).toBe(id);
      expect(page.items[0]?.status).toBe("queued");

      const stats = await jobs.stats(tx);
      expect(stats.queued).toBeGreaterThanOrEqual(1);
      expect(stats.oldestQueuedSec).toBeGreaterThanOrEqual(0);
      expect(Object.keys(stats).sort()).toEqual(
        ["dead", "done", "failed", "oldestQueuedSec", "queued", "running"].sort(),
      );

      // Not dead yet → retry is a no-op.
      await jobs.retry(tx, id, ACTOR);
      expect((await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0]?.attempts).toBe(0);

      await jobs.claim(tx, "w1", [type], new Date());
      expect(await jobs.fail(tx, id, "boom")).toBe("dead");
      await jobs.retry(tx, id, ACTOR);
      const revived = (await tx.select().from(jobsTable).where(eq(jobsTable.id, id)))[0];
      expect(revived?.status).toBe("queued");
      expect(revived?.attempts).toBe(0);
      expect(revived?.finishedAt).toBeNull();

      const audited = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, "jobs"), eq(auditLog.entityId, id)));
      expect(audited).toHaveLength(1);
      expect(audited[0]?.action).toBe("job.retry");

      expect(await jobs.list(tx, { status: "dead", type, page: 1 })).toMatchObject({ total: 0 });
      await jobs.retry(tx, `missing-${RUN}`, ACTOR);
    });
  });

  /** A row aged by hand: `finished_at` is the only column prune reads, and complete()/fail() stamp now. */
  async function finished(tx: Db, type: JobType, status: "done" | "dead", daysAgo: number): Promise<string> {
    const id = await jobs.enqueue(tx, type, { daysAgo });
    await tx
      .update(jobsTable)
      .set({ status, finishedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000) })
      .where(eq(jobsTable.id, id));
    return id;
  }

  it("prune deletes finished rows past their retention, in batches, and is idempotent", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("prune");
      // prune() is table-wide by design, so anything an earlier run left behind would be counted
      // below. Clearing it here (inside the rolled-back tx) makes the numbers exactly ours; only
      // rows already a day old are touched, never a row another suite is still writing.
      await tx.delete(jobsTable).where(lt(jobsTable.finishedAt, minutesAgo(24 * 60)));

      const staleDone = [await finished(tx, type, "done", 10), await finished(tx, type, "done", 8)];
      const staleDead = await finished(tx, type, "dead", 40);
      const freshDone = await finished(tx, type, "done", 2);
      const freshDead = await finished(tx, type, "dead", 10);
      const queued = await jobs.enqueue(tx, type, { keep: true });

      const first = await jobs.prune(tx, { batch: 1 });
      expect(first).toMatchObject({ done: 2, dead: 1, capped: false });
      // batch 1 → one statement per row, plus the empty one that ends each status: 3 + 2.
      expect(first.batches).toBe(5);

      const left = (await tx.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.type, type))).map((r) => r.id);
      // Fresh terminal rows and everything unfinished survive at any age.
      expect(left.sort()).toEqual([freshDone, freshDead, queued].sort());
      for (const id of [...staleDone, staleDead]) expect(left).not.toContain(id);

      // Idempotent: the second run finds nothing and writes nothing.
      expect(await jobs.prune(tx, { batch: 1 })).toEqual({ done: 0, dead: 0, batches: 2, capped: false });
    });
  });

  it("prune stops at its per-run ceiling and says so", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const type = testType("prune-cap");
      await tx.delete(jobsTable).where(lt(jobsTable.finishedAt, minutesAgo(24 * 60)));
      for (let i = 0; i < 3; i += 1) await finished(tx, type, "done", 30);

      const capped = await jobs.prune(tx, { batch: 1, maxBatches: 2 });
      expect(capped).toEqual({ done: 2, dead: 0, batches: 2, capped: true });
      // The remainder is still there for the next run - nothing is lost, the lock is just released.
      expect(await tx.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.type, type))).toHaveLength(1);
    });
  });
});
