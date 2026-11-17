import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobs, ulid } from "@namilux/core";
import type { JobType } from "@namilux/core";
import { and, eq, jobs as jobsTable, like } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { TIMEOUTS_MS, startRuntime } from "../runtime";
import type { Drivers, Handler, Logger } from "../runtime";
import type { WorkerEnv } from "../env";

const RUN = ulid().slice(-6).toLowerCase();
const testType = (name: string): JobType => `test.rt.${name}.${RUN}` as JobType;
const TYPE_PREFIX = `test.rt.%${RUN}`;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const noDrivers = {} as unknown as Drivers;
const noEnv = {} as unknown as WorkerEnv;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error("waitFor timed out");
}

async function jobStatus(db: Db, id: string): Promise<{ status: string; attempts: number; lastError: string | null } | null> {
  const rows = await db
    .select({ status: jobsTable.status, attempts: jobsTable.attempts, lastError: jobsTable.lastError })
    .from(jobsTable)
    .where(eq(jobsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

describe.skipIf(!hasTestDb())("worker runtime", () => {
  let tdb: TestDb;
  let db: Db;

  beforeAll(async () => {
    tdb = await createTestDb();
    db = tdb.db;
  });
  afterAll(async () => {
    await db.delete(jobsTable).where(like(jobsTable.type, TYPE_PREFIX));
    await tdb.close();
  });

  async function run(type: JobType, handler: Handler, opts?: { concurrency?: number }): Promise<{ stop(): Promise<void> }> {
    return startRuntime(
      { concurrency: opts?.concurrency ?? 1, types: [type], workerId: `test-${RUN}`, pollMs: 50 },
      { db, drivers: noDrivers, env: noEnv, handlers: { [type]: handler }, log: silent },
    );
  }

  it("runs a queued job to completion", async () => {
    const type = testType("ok");
    const id = await jobs.enqueue(db, type, { n: 1 });
    const rt = await run(type, async () => {});
    await waitFor(async () => (await jobStatus(db, id))?.status === "done");
    await rt.stop();
    expect((await jobStatus(db, id))?.status).toBe("done");
  });

  it("a throwing handler requeues with backoff (attempts 1)", async () => {
    const type = testType("retry");
    const id = await jobs.enqueue(db, type, {});
    const rt = await run(type, async () => {
      throw new Error("boom");
    });
    await waitFor(async () => (await jobStatus(db, id))?.attempts === 1);
    await rt.stop();
    const row = await jobStatus(db, id);
    expect(row?.status).toBe("queued"); // requeued, not dead
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("boom");
  });

  it("dead-letters after max attempts", async () => {
    const type = testType("dead");
    const id = await jobs.enqueue(db, type, {}, { maxAttempts: 1 });
    const rt = await run(type, async () => {
      throw new Error("always fails");
    });
    await waitFor(async () => (await jobStatus(db, id))?.status === "dead");
    await rt.stop();
    expect((await jobStatus(db, id))?.status).toBe("dead");
  });

  it("unique_key dedupes queued jobs to one row", async () => {
    const type = testType("dedupe");
    const key = `uk:${RUN}`;
    const a = await jobs.enqueue(db, type, {}, { uniqueKey: key });
    const b = await jobs.enqueue(db, type, {}, { uniqueKey: key });
    expect(b).toBe(a);
    const rows = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.type, type), eq(jobsTable.uniqueKey, key)));
    expect(rows).toHaveLength(1);
  });

  it("graceful shutdown lets the running job finish", async () => {
    const type = testType("drain");
    const id = await jobs.enqueue(db, type, {});
    let finished = false;
    const rt = await run(type, async () => {
      await sleep(300);
      finished = true;
    });
    // Wait until the job is claimed (running), then stop mid-flight.
    await waitFor(async () => (await jobStatus(db, id))?.status === "running");
    await rt.stop();
    expect(finished).toBe(true);
    expect((await jobStatus(db, id))?.status).toBe("done");
  });

  it("per-type timeout aborts and fails the job", async () => {
    const type = testType("timeout");
    TIMEOUTS_MS[type] = 200;
    const id = await jobs.enqueue(db, type, {}, { maxAttempts: 1 });
    const rt = await run(type, async ({ signal }) => {
      // Never completes on its own; only the abort ends it.
      await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    await waitFor(async () => (await jobStatus(db, id))?.status === "dead");
    await rt.stop();
    delete TIMEOUTS_MS[type];
    expect((await jobStatus(db, id))?.lastError).toBe("timeout");
  });
});
