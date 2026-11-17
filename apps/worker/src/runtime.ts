import { jobs } from "@namilux/core";
import type { Job, JobType } from "@namilux/core";
import type { Db } from "@namilux/db";
import type { CdnDriver, SmsDriver, StorageDriver, paymentDrivers, telegramClient } from "@namilux/integrations";
import { createGate } from "./gate";
import { startHeartbeat } from "./heartbeat";
import { log as defaultLog } from "./logger";
import type { Logger } from "./logger";
import type { WorkerEnv } from "./env";

export type Drivers = {
  sms: SmsDriver;
  cdn: CdnDriver;
  storage: StorageDriver;
  telegram: ReturnType<typeof telegramClient>;
  payment: ReturnType<typeof paymentDrivers>;
};
export type { WorkerEnv, Logger };
export type HandlerCtx = { db: Db; drivers: Drivers; env: WorkerEnv; log: Logger; job: Job; signal: AbortSignal };
export type Handler = (ctx: HandlerCtx) => Promise<void>;
export type RuntimeOpts = {
  concurrency: number;
  types: readonly JobType[];
  workerId: string;
  pollMs?: number;
  /** How long an aborted handler may take to unwind before it is treated as abandoned. */
  abortGraceMs?: number;
};

/** One job currently in a handler, with the wall-clock deadline healthz judges it against. */
export type ActiveJob = { id: string; type: JobType; startedAt: number; deadlineAt: number };

/** Live, read-only-for-consumers view of the loop used by healthz.ts. */
export type RuntimeState = {
  workerId: string;
  startedAt: number;
  /** Slots configured; also the number of handlers that may execute at once. */
  capacity: number;
  running: number;
  /** Handlers that ignored their abort and are still executing; each one holds a slot. */
  abandoned: number;
  lastClaimAt: number | null;
  lastTickAt: number;
  /**
   * Updated by a plain interval, so it goes stale only when the event loop itself is blocked.
   * `lastTickAt` cannot tell that apart from a slot legitimately sitting inside a 30-minute crawl.
   */
  lastLoopAt: number;
  activeJobs: ReadonlyMap<string, ActiveJob>;
  stopping: boolean;
};

/** Per-type wall-clock ceilings; a handler that runs longer is aborted and failed with "timeout". */
export const TIMEOUTS_MS: Partial<Record<JobType, number>> = {
  // SnappPay's documented recovery chain (verify/status/settle retries, 30 s verify) can take ~200 s
  // when their side is slow; normal runs take a second or two.
  "payment.settle": 300_000,
  "order.expire": 600_000,
  "media.process": 300_000,
  "seo.crawl": 1_800_000,
  "sms.campaign": 600_000,
};
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Job types that decode images. One at a time process-wide: four slots each holding a decoded
 * source is how a 300 MiB spike becomes 1.2 GiB on a box with 3.9 GiB and two Next processes
 * (audit §5). The permit is taken before the claim, so a busy gate simply leaves the media row in
 * the queue instead of blocking a slot that could be running an order or an SMS.
 */
export const MEDIA_TYPES: ReadonlySet<string> = new Set(["media.process", "og.generate"]);
/** Grace an aborted handler gets to unwind before the runtime stops trusting it (audit §4). */
export const ABORT_GRACE_MS = 15_000;

const POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const REQUEUE_EVERY_MS = 5 * 60_000;
const REQUEUE_STALE_MIN = 15;
const SHUTDOWN_GRACE_MS = 60_000;
const DB_BACKOFF_MAX_MS = 30_000;
const LOOP_TICK_MS = 1_000;

/**
 * Abortable timer. The listener is removed when the *timer* wins as well as when the abort does:
 * the original only cleaned up on abort, so four idle slots polling every five seconds accumulated
 * ~69,000 listeners a day on the shutdown signal, all retained until the process stopped (audit §1).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal === undefined) {
      setTimeout(resolve, ms);
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

/** A promise that settles on abort, with the same symmetrical cleanup as `sleep`. */
function onAborted(signal: AbortSignal): { promise: Promise<void>; dispose(): void } {
  if (signal.aborted) return { promise: Promise.resolve(), dispose: () => {} };
  let dispose = (): void => {};
  const promise = new Promise<void>((resolve) => {
    const listener = (): void => resolve();
    signal.addEventListener("abort", listener, { once: true });
    dispose = () => signal.removeEventListener("abort", listener);
  });
  return { promise, dispose: () => dispose() };
}

/** Cooperative cancellation point for handlers: cheap to call, throws only once aborted. */
export function throwIfAborted(signal: AbortSignal): void {
  signal.throwIfAborted();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function timeoutFor(type: JobType): number {
  return TIMEOUTS_MS[type] ?? DEFAULT_TIMEOUT_MS;
}

export async function startRuntime(
  opts: RuntimeOpts,
  deps: { db: Db; drivers: Drivers; env: WorkerEnv; handlers: Record<string, Handler>; log?: Logger },
): Promise<{ stop(): Promise<void>; state: RuntimeState }> {
  const { db, drivers, env, handlers } = deps;
  const logger: Logger = deps.log ?? defaultLog;
  const pollMs = opts.pollMs ?? POLL_MS;
  const idleMs = pollMs === POLL_MS ? IDLE_POLL_MS : pollMs;
  const abortGraceMs = opts.abortGraceMs ?? ABORT_GRACE_MS;
  const capacity = Math.max(1, opts.concurrency);
  const activeJobs = new Map<string, ActiveJob>();
  // Types this worker may claim while the media permit is held by another slot.
  const lightTypes = opts.types.filter((t) => !MEDIA_TYPES.has(t));

  const state: RuntimeState = {
    workerId: opts.workerId,
    startedAt: Date.now(),
    capacity,
    running: 0,
    abandoned: 0,
    lastClaimAt: null,
    lastTickAt: Date.now(),
    lastLoopAt: Date.now(),
    activeJobs,
    stopping: false,
  };

  // A single controller aborts every sleeping slot the instant stop() is called.
  const shutdown = new AbortController();
  const mediaGate = createGate(1);
  // Event-loop liveness, independent of how long any job runs. Unref'd: it must never be the reason
  // the process stays alive.
  const loopTimer = setInterval(() => {
    state.lastLoopAt = Date.now();
  }, LOOP_TICK_MS);
  loopTimer.unref();

  /** Run one claimed job to a terminal state; never throws (the loop must survive any handler). */
  async function runJob(job: Job): Promise<void> {
    state.running += 1;
    const started = Date.now();
    const controller = new AbortController();
    const budget = timeoutFor(job.type);
    activeJobs.set(job.id, { id: job.id, type: job.type, startedAt: started, deadlineAt: started + budget });

    // The handler's own settlement is tracked separately from the races below, so the runtime always
    // knows whether the handler is still executing. `work` itself never rejects: an abandoned
    // handler that fails minutes later must not surface as an unhandled rejection.
    const result: { settled: "pending" | "ok" | "error" } = { settled: "pending" };
    let failure: unknown = null;
    const handler = handlers[job.type];
    const ctx: HandlerCtx = { db, drivers, env, log: logger, job, signal: controller.signal };
    const work = (handler === undefined
      ? Promise.reject(new Error(`no handler for job type ${job.type}`))
      : (async () => handler(ctx))()
    ).then(
      () => {
        result.settled = "ok";
      },
      (err: unknown) => {
        result.settled = "error";
        failure = err;
      },
    );

    const timer = setTimeout(() => controller.abort(), budget);
    const aborted = onAborted(controller.signal);
    let abandoned = false;
    try {
      await Promise.race([work, aborted.promise]);
      if (result.settled === "pending") {
        // Aborted and still running. Give the handler its grace period to unwind cooperatively
        // before concluding that it is never going to.
        await Promise.race([work, sleep(abortGraceMs, shutdown.signal)]);
      }
      abandoned = result.settled === "pending";
      if (result.settled === "error") throw failure;
      if (abandoned) {
        // Keep both the claim and slot until settlement. Retrying while the original handler is
        // still executing can duplicate external side effects, even with a concurrency limit.
        state.abandoned += 1;
        logger.error({ jobId: job.id, type: job.type }, "handler ignored abort; retaining claim and slot");
        await work;
        throw new Error("timeout");
      }
      await jobs.complete(db, job.id);
      logger.info({ jobId: job.id, type: job.type, ms: Date.now() - started, outcome: "done" });
    } catch (err) {
      const message = controller.signal.aborted ? "timeout" : errorText(err);
      let outcome: string;
      try {
        outcome = await jobs.fail(db, job.id, message);
      } catch {
        outcome = "fail-write-error";
      }
      logger.warn({ jobId: job.id, type: job.type, ms: Date.now() - started, outcome, error: message, abandoned });
    } finally {
      clearTimeout(timer);
      aborted.dispose();
      activeJobs.delete(job.id);
      if (abandoned) {
        state.abandoned -= 1;
        logger.warn(
          { jobId: job.id, type: job.type, ms: Date.now() - started, outcome: result.settled },
          "abandoned handler finally settled; slot released",
        );
      }
      state.running -= 1;
    }
  }

  /** One slot: claim → run → repeat; idle → back off; DB error → exponential backoff, never crash. */
  async function slotLoop(): Promise<void> {
    let dbBackoff = 0;
    while (!state.stopping) {
      state.lastTickAt = Date.now();
      // Take the image permit *before* claiming, so two slots cannot both claim media work; when it
      // is already held this slot claims everything else instead of waiting on it.
      let permit = mediaGate.tryAcquire();
      const release = (): void => {
        if (permit) {
          permit = false;
          mediaGate.release();
        }
      };
      const claimTypes = permit ? opts.types : lightTypes;
      if (claimTypes.length === 0) {
        // This worker handles nothing but image types and another slot is on one: idle, don't spin.
        release();
        await sleep(idleMs, shutdown.signal);
        continue;
      }
      let job: Job | null = null;
      try {
        job = await jobs.claim(db, opts.workerId, claimTypes);
        dbBackoff = 0;
      } catch (err) {
        release();
        // The database is unreachable: back off (capped) and try again; the process stays up.
        dbBackoff = Math.min(dbBackoff === 0 ? 1_000 : dbBackoff * 2, DB_BACKOFF_MAX_MS);
        logger.error({ err: err instanceof Error ? err.message : String(err), backoffMs: dbBackoff }, "claim failed");
        await sleep(dbBackoff, shutdown.signal);
        continue;
      }
      if (job === null || !MEDIA_TYPES.has(job.type)) release();
      if (job === null) {
        await sleep(idleMs, shutdown.signal);
        continue;
      }
      state.lastClaimAt = Date.now();
      try {
        await runJob(job);
      } finally {
        release();
      }
    }
  }

  // requeueStale recovers a crashed worker's rows; runs immediately then every 5 min.
  async function requeueTick(): Promise<void> {
    try {
      const n = await jobs.requeueStale(db, REQUEUE_STALE_MIN, [...activeJobs.keys()]);
      if (n > 0) logger.warn({ recovered: n }, "requeued stale jobs");
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "requeueStale failed");
    }
  }
  await requeueTick();
  const requeueInterval = setInterval(() => void requeueTick(), REQUEUE_EVERY_MS);

  const heartbeat = startHeartbeat(db, opts.workerId, HEARTBEAT_MS, () => ({ running: state.running, uptimeSec: Math.round((Date.now() - state.startedAt) / 1000) }), logger);

  const slots = Array.from({ length: capacity }, () => slotLoop());

  async function stop(): Promise<void> {
    if (state.stopping) return;
    state.stopping = true;
    shutdown.abort();
    clearInterval(requeueInterval);
    clearInterval(loopTimer);
    heartbeat.stop();
    // Wait for the slots to notice the flag and drain their running job (≤ 60 s), then give up.
    await Promise.race([
      Promise.allSettled(slots),
      sleep(SHUTDOWN_GRACE_MS),
    ]);
  }

  return { stop, state };
}
