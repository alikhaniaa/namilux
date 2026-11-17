import { and, count, desc, eq, isNotNull, jobs as jobsTable, lt, notInArray, sql } from "@namilux/db";
import type { Db } from "@namilux/db";
import { audit } from "./audit";
import { JOB_BACKOFF_MIN, JOB_MAX_ATTEMPTS_DEFAULT, JOB_STATUSES } from "./constants";
import type { JobStatus, JobType } from "./constants";
import { ulid } from "./ids";
import type { Actor, Job, JsonObject, Paged } from "./types";

export type EnqueueOpts = { runAt?: Date; uniqueKey?: string; maxAttempts?: number; priority?: number };

/** rules: payloads are JSON only and ≤ 64 KB. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;
export const JOBS_PAGE_SIZE = 50;
const MAX_ERROR_LEN = 2000;

/**
 * Retention for `prune()`. Nothing else in the system ever deletes a job row, and the two
 * every-minute schedules (order.expire, reservation.expire) alone add 2,880 a day - the launch
 * audit found 26,000 finished rows. A week of `done` is what an operator can still be asked about;
 * a month of `dead` outlives the retry ladder (1+5+25+125 min) and any Monday-morning triage.
 */
export const JOBS_DONE_RETENTION_DAYS = 7;
export const JOBS_DEAD_RETENTION_DAYS = 30;
/** One statement per batch - short locks, and the queue keeps moving between them. */
export const JOBS_PRUNE_BATCH = 2_000;
/** Ceiling per run (50,000 rows): a first pass over a huge backlog must still fit the job budget. */
export const JOBS_PRUNE_MAX_BATCHES = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * DECISION: the `jobs` table (the spec, owned by @namilux/db) has no `priority` column, but the
 * contract orders `claim()` by "priority desc". Priority therefore lives in the payload under a
 * reserved key, and `claim`/`list` strip it again so no handler ever sees it. Reported in
 * the spec - the column belongs in the schema.
 */
const PRIORITY_KEY = "__priority";

/**
 * DECISION: "worker.heartbeat" is not in JOB_TYPES and constants.ts is DONE ("adding a JobType
 * requires a handler in apps/worker … and a row in the spec"), so the heartbeat uses the literal
 * the contract names. `jobs.type` is a `text` column, and a heartbeat row can never be claimed
 * because `claim()` filters on the caller's explicit type list.
 * DECISION: heartbeat rows are stored `done` with `finished_at = now` so they never enter the
 * queue and never distort `stats().oldestQueuedSec`; `finished_at` IS the heartbeat timestamp
 * (WORKER_HEARTBEAT_STALE_SEC is measured against it).
 */
const HEARTBEAT_TYPE = "worker.heartbeat";
const HEARTBEAT_MAX_ATTEMPTS = 1;

export function backoffMinutes(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.trunc(attempt) : 1;
  const index = Math.min(Math.max(n, 1), JOB_BACKOFF_MIN.length) - 1;
  return JOB_BACKOFF_MIN[index] ?? JOB_BACKOFF_MIN[0];
}

function clampPage(page: number | undefined): number {
  if (typeof page !== "number" || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.trunc(page));
}

function clampMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return JOB_MAX_ATTEMPTS_DEFAULT;
  // The table CHECK is `max_attempts >= 1`; a caller typo must not abort the insert.
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function clipError(error: string): string {
  const text = typeof error === "string" ? error : String(error);
  return text.length > MAX_ERROR_LEN ? text.slice(0, MAX_ERROR_LEN) : text;
}

function withPriority(payload: JsonObject, priority: number | undefined): Record<string, unknown> {
  const base: Record<string, unknown> = { ...payload };
  delete base[PRIORITY_KEY];
  if (typeof priority === "number" && Number.isFinite(priority) && Math.trunc(priority) !== 0) {
    base[PRIORITY_KEY] = Math.trunc(priority);
  }
  return base;
}

function stripPriority(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out = { ...(payload as Record<string, unknown>) };
  delete out[PRIORITY_KEY];
  return out;
}

/**
 * DECISION: an oversized payload throws a `RangeError`, not an AppError - ../errors is not in this
 * header's dependency list, and a 64 KB job payload is a programmer error (payloads are built by core,
 * never by a request body), exactly like the RangeErrors url/routes.ts throws.
 */
function assertPayload(payload: Record<string, unknown>): void {
  let json: string;
  try {
    json = JSON.stringify(payload) ?? "";
  } catch {
    throw new RangeError("jobs.enqueue: payload is not JSON-serializable");
  }
  if (Buffer.byteLength(json, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`jobs.enqueue: payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
}

type JobRowSource = {
  id: string;
  type: string;
  payloadJson: unknown;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  uniqueKey: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

function toJob(row: JobRowSource): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: stripPriority(row.payloadJson),
    status: row.status,
    runAt: row.runAt.toISOString(),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    lockedBy: row.lockedBy,
    lockedAt: row.lockedAt === null ? null : row.lockedAt.toISOString(),
    uniqueKey: row.uniqueKey,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
  };
}

/** `db.execute` hands back snake_case columns; claim is the only statement that needs raw SQL. */
type RawJobRow = {
  id: string;
  type: string;
  payload_json: unknown;
  status: JobStatus;
  run_at: string | Date;
  attempts: number | string;
  max_attempts: number | string;
  last_error: string | null;
  locked_by: string | null;
  locked_at: string | Date | null;
  unique_key: string | null;
  created_at: string | Date;
  finished_at: string | Date | null;
};

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function fromRaw(row: RawJobRow): Job {
  return toJob({
    id: row.id,
    type: row.type,
    payloadJson: row.payload_json,
    status: row.status,
    runAt: toDate(row.run_at),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at === null ? null : toDate(row.locked_at),
    uniqueKey: row.unique_key,
    createdAt: toDate(row.created_at),
    finishedAt: row.finished_at === null ? null : toDate(row.finished_at),
  });
}

export type PruneOpts = {
  doneDays?: number | undefined;
  deadDays?: number | undefined;
  batch?: number | undefined;
  maxBatches?: number | undefined;
  now?: Date | undefined;
};
export type PruneResult = { done: number; dead: number; batches: number; capped: boolean };

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

/**
 * One batch. The status is written as a SQL literal rather than a bind parameter - the column is an
 * enum and an untyped parameter would need a cast; the two literals are the only values that ever
 * reach it. The `id in (select … limit n)` shape is what bounds the statement: the planner picks
 * the rows, deletes them, and the lock is released with the statement.
 */
async function deleteFinishedBatch(db: Db, status: "done" | "dead", cutoff: Date, batch: number): Promise<number> {
  const statusSql = status === "done" ? sql`'done'` : sql`'dead'`;
  const rows = await db.execute(sql`
    delete from ${jobsTable}
     where id in (
       select id from ${jobsTable}
        where status = ${statusSql}
          and finished_at is not null
          and finished_at < ${cutoff.toISOString()}::timestamptz
        limit ${batch}
     )
    returning id
  `);
  return (rows as unknown as { id: string }[]).length;
}

export const jobs = {
  /**
   * DECISION: the DB index is `unique (unique_key) where unique_key is not null` - it spans EVERY
   * status, not just queued/running as the EDGE CASE (line 34) assumes. That, plus the 05 roles
   * matrix granting `nl_web` only SELECT+INSERT on jobs (no UPDATE), means a unique-key conflict is
   * resolved by DEDUPE, never RECYCLE: DO NOTHING on conflict, then return the existing row's id - 
   * whatever its status. A terminal (done/dead/failed) row with the same key therefore blocks a
   * fresh enqueue and returns that row's id instead of the spec's "done → new job". This is benign
   * for every caller: web unique keys embed a per-event token (order id, question id, movement id,
   * or a time bucket / day), so re-running the exact same logical work is neither expected nor
   * wanted. An earlier build used `ON CONFLICT DO UPDATE` to recycle terminal rows, but that needs
   * UPDATE and so 42501-failed for every web enqueue (order.paid SMS, back-in-stock, security
   * alerts). Honouring the least-privilege grant (the higher-authority decision) wins. Reported in
   * the spec. (heartbeat below keeps DO UPDATE - it runs only as nl_worker.)
   */
  async enqueue(db: Db, type: JobType, payload: JsonObject, opts?: EnqueueOpts): Promise<string> {
    const stored = withPriority(payload, opts?.priority);
    assertPayload(stored);
    const id = ulid();
    const runAt = opts?.runAt instanceof Date && !Number.isNaN(opts.runAt.getTime()) ? opts.runAt : new Date();
    const maxAttempts = clampMaxAttempts(opts?.maxAttempts);
    const uniqueKey = typeof opts?.uniqueKey === "string" && opts.uniqueKey !== "" ? opts.uniqueKey : null;
    const values = {
      id,
      type,
      payloadJson: stored,
      status: "queued" as const,
      runAt,
      attempts: 0,
      maxAttempts,
      lastError: null,
      lockedBy: null,
      lockedAt: null,
      uniqueKey,
      finishedAt: null,
    };

    if (uniqueKey === null) {
      await db.insert(jobsTable).values(values);
      return id;
    }

    // A unique key must NOT require UPDATE on jobs. `nl_web` is granted only SELECT+INSERT on the
    // table (the spec roles matrix - least privilege; admin/worker get UPDATE/DELETE), and Postgres
    // checks the UPDATE privilege for `ON CONFLICT DO UPDATE` statically at plan time, even when the
    // update branch never runs. So dedupe with DO NOTHING (INSERT-only) and, on a conflict, return
    // the row that already holds the key.
    const inserted = await db
      .insert(jobsTable)
      .values(values)
      .onConflictDoNothing({ target: jobsTable.uniqueKey, where: sql`${jobsTable.uniqueKey} is not null` })
      .returning({ id: jobsTable.id });
    const freshId = inserted[0]?.id;
    if (freshId !== undefined) return freshId;

    const existing = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.uniqueKey, uniqueKey))
      .limit(1);
    return existing[0]?.id ?? id;
  },

  async claim(db: Db, workerId: string, types: readonly JobType[], now?: Date): Promise<Job | null> {
    if (types.length === 0) return null;
    const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const typeList = sql.join(
      types.map((type) => sql`${type}`),
      sql`, `,
    );
    // A raw `sql` template carries no column encoder, so the instant is bound as an ISO string and
    // cast in SQL (postgres-js cannot serialize a bare Date outside the query builder).
    const atIso = at.toISOString();
    // One statement = one implicit transaction: the row is owned by workerId after it returns.
    // The priority expression is guarded by a regex so a hostile payload cannot break the cast, and
    // the key is written as a SQL literal (a bind parameter would leave `->>` ambiguous) - it must
    // stay identical to PRIORITY_KEY above.
    const result = await db.execute(sql`
      update ${jobsTable}
         set status = 'running', locked_by = ${workerId}, locked_at = ${atIso}::timestamptz
       where id = (
         select id from ${jobsTable}
          where status = 'queued'
            and run_at <= ${atIso}::timestamptz
            and type in (${typeList})
          order by case
                     when payload_json->>'__priority' ~ '^-?[0-9]{1,9}$'
                     then (payload_json->>'__priority')::int
                     else 0
                   end desc,
                   run_at asc,
                   created_at asc
          for update skip locked
          limit 1
       )
      returning id, type, payload_json, status, run_at, attempts, max_attempts,
                last_error, locked_by, locked_at, unique_key, created_at, finished_at
    `);
    const rows = result as unknown as RawJobRow[];
    const row = rows[0];
    return row === undefined ? null : fromRaw(row);
  },

  async complete(db: Db, id: string): Promise<void> {
    await db
      .update(jobsTable)
      .set({ status: "done", finishedAt: new Date(), lockedBy: null, lockedAt: null })
      .where(eq(jobsTable.id, id));
  },

  async fail(db: Db, id: string, error: string): Promise<"retry" | "dead"> {
    const found = await db
      .select({ status: jobsTable.status, attempts: jobsTable.attempts, maxAttempts: jobsTable.maxAttempts })
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1);
    const row = found[0];
    // DECISION: an unknown or already terminal job reports "dead" without writing a row - the
    // caller's only use of the return value is "should I be retried?", and the answer is no.
    if (row === undefined || row.status === "done" || row.status === "dead") return "dead";

    const attempts = row.attempts + 1;
    const lastError = clipError(error);
    const guard = and(eq(jobsTable.id, id), sql`${jobsTable.status} not in ('done', 'dead')`);
    if (attempts >= row.maxAttempts) {
      await db
        .update(jobsTable)
        .set({ status: "dead", attempts, lastError, finishedAt: new Date(), lockedBy: null, lockedAt: null })
        .where(guard);
      return "dead";
    }
    const runAt = new Date(Date.now() + backoffMinutes(attempts) * 60_000);
    await db
      .update(jobsTable)
      .set({ status: "queued", attempts, lastError, runAt, lockedBy: null, lockedAt: null })
      .where(guard);
    return "retry";
  },

  async requeueStale(db: Db, olderThanMin: number, activeIds: readonly string[] = []): Promise<number> {
    const minutes = Number.isFinite(olderThanMin) ? Math.max(0, olderThanMin) : 0;
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const rows = await db
      .update(jobsTable)
      .set({ status: "queued", lockedBy: null, lockedAt: null })
      .where(and(
        eq(jobsTable.status, "running"), isNotNull(jobsTable.lockedAt), lt(jobsTable.lockedAt, cutoff),
        activeIds.length > 0 ? notInArray(jobsTable.id, [...activeIds]) : undefined,
      ))
      .returning({ id: jobsTable.id });
    return rows.length;
  },

  /**
   * Deletes finished rows: `done` older than `doneDays`, `dead` older than `deadDays`, measured on
   * `finished_at` (the only column that says when a row stopped being work). Idempotent - a second
   * run finds nothing - and batched: each DELETE is its own statement, so the table is never held
   * under one long lock while the queue is running. `capped` reports that the ceiling was reached
   * and rows remain for the next run.
   *
   * DECISION: `queued`, `running` and `failed` are never touched at any age. A `failed` row is
   * mid-retry ladder (it carries a future run_at, and no finished_at), and a `running` row that
   * outlived its worker is requeueStale's business, not this one's.
   * DECISION: worker heartbeat rows are `done` too and are pruned with the rest - a heartbeat a
   * week old is not a heartbeat, and dropping it frees its unique_key for a fresh row.
   */
  async prune(db: Db, opts?: PruneOpts): Promise<PruneResult> {
    const now = opts?.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();
    const batch = clampPositive(opts?.batch, JOBS_PRUNE_BATCH, 10_000);
    const maxBatches = clampPositive(opts?.maxBatches, JOBS_PRUNE_MAX_BATCHES, 1_000);
    const cutoffs = {
      done: new Date(now.getTime() - clampPositive(opts?.doneDays, JOBS_DONE_RETENTION_DAYS, 3_650) * DAY_MS),
      dead: new Date(now.getTime() - clampPositive(opts?.deadDays, JOBS_DEAD_RETENTION_DAYS, 3_650) * DAY_MS),
    };

    const deleted: Record<"done" | "dead", number> = { done: 0, dead: 0 };
    let batches = 0;
    let capped = false;
    for (const status of ["done", "dead"] as const) {
      for (;;) {
        if (batches >= maxBatches) {
          capped = true;
          break;
        }
        const n = await deleteFinishedBatch(db, status, cutoffs[status], batch);
        batches += 1;
        deleted[status] += n;
        if (n < batch) break;
      }
    }
    return { done: deleted.done, dead: deleted.dead, batches, capped };
  },

  /** Newest worker heartbeat (any worker) - null when no worker has ever reported. */
  async lastHeartbeat(db: Db): Promise<string | null> {
    const rows = await db
      .select({ at: sql<string | null>`max(${jobsTable.finishedAt})::text` })
      .from(jobsTable)
      .where(eq(jobsTable.type, HEARTBEAT_TYPE));
    const at = rows[0]?.at ?? null;
    return at === null ? null : new Date(at).toISOString();
  },

  async heartbeat(db: Db, workerId: string, meta: JsonObject): Promise<void> {
    const now = new Date();
    const payload: Record<string, unknown> = { ...meta, workerId, ts: now.toISOString() };
    assertPayload(payload);
    await db
      .insert(jobsTable)
      .values({
        id: ulid(),
        type: HEARTBEAT_TYPE,
        payloadJson: payload,
        status: "done",
        runAt: now,
        attempts: 0,
        maxAttempts: HEARTBEAT_MAX_ATTEMPTS,
        lastError: null,
        lockedBy: workerId,
        lockedAt: now,
        uniqueKey: workerId,
        finishedAt: now,
      })
      .onConflictDoUpdate({
        target: jobsTable.uniqueKey,
        targetWhere: sql`${jobsTable.uniqueKey} is not null`,
        set: {
          type: HEARTBEAT_TYPE,
          payloadJson: payload,
          status: "done",
          runAt: now,
          lockedBy: workerId,
          lockedAt: now,
          finishedAt: now,
        },
      });
  },

  async stats(db: Db): Promise<Record<JobStatus, number> & { oldestQueuedSec: number }> {
    const grouped = await db
      .select({ status: jobsTable.status, n: count() })
      .from(jobsTable)
      .groupBy(jobsTable.status);
    const out = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<JobStatus, number>;
    for (const row of grouped) out[row.status] = row.n;

    const oldest = await db
      .select({
        sec: sql<string | number | null>`extract(epoch from (now() - min(${jobsTable.runAt})))`,
      })
      .from(jobsTable)
      .where(and(eq(jobsTable.status, "queued"), sql`${jobsTable.runAt} <= now()`));
    const raw = oldest[0]?.sec;
    const seconds = raw === null || raw === undefined ? 0 : Number(raw);
    return { ...out, oldestQueuedSec: Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0 };
  },

  async list(db: Db, q: { status?: JobStatus; type?: JobType; page?: number }): Promise<Paged<Job>> {
    const page = clampPage(q.page);
    const conditions = [];
    if (q.status !== undefined) conditions.push(eq(jobsTable.status, q.status));
    if (q.type !== undefined) conditions.push(eq(jobsTable.type, q.type));
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = await db
      .select()
      .from(jobsTable)
      .where(where)
      .orderBy(desc(jobsTable.createdAt), desc(jobsTable.id))
      .limit(JOBS_PAGE_SIZE)
      .offset((page - 1) * JOBS_PAGE_SIZE);
    const totals = await db.select({ n: count() }).from(jobsTable).where(where);

    return {
      items: rows.map((row) => toJob(row as JobRowSource)),
      total: totals[0]?.n ?? 0,
      page,
      pageSize: JOBS_PAGE_SIZE,
    };
  },

  /**
   * DECISION: the retry is audit-logged even though ../audit is absent from dependency list - `retry`
   * is the only member taking an `Actor`, every other admin write in core records one (the spec
   * "every write is audit-logged"), and the parameter would otherwise be dead. No cycle: audit.ts
   * imports nothing from here.
   * DECISION: a missing or not-dead job is a no-op - the contract returns void and ../errors is
   * not in dependency list, so there is no code to raise.
   */
  async retry(db: Db, id: string, actor: Actor): Promise<void> {
    const found = await db
      .select({ status: jobsTable.status, attempts: jobsTable.attempts, lastError: jobsTable.lastError })
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .limit(1);
    const before = found[0];
    if (before === undefined || before.status !== "dead") return;

    const rows = await db
      .update(jobsTable)
      .set({ status: "queued", attempts: 0, runAt: new Date(), lockedBy: null, lockedAt: null, finishedAt: null })
      .where(and(eq(jobsTable.id, id), eq(jobsTable.status, "dead")))
      .returning({ id: jobsTable.id });
    if (rows.length === 0) return;

    await audit.log(
      db,
      actor,
      "job.retry",
      "jobs",
      id,
      { status: before.status, attempts: before.attempts, lastError: before.lastError },
      { status: "queued", attempts: 0 },
    );
  },
};
