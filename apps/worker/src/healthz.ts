import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Logger } from "./logger";
import type { RuntimeState } from "./runtime";

export const HEALTHZ_PORT = 3200;
/** An *idle* slot must poll well inside this; a busy slot is judged by its job deadline instead. */
export const STUCK_MS = 2 * 60_000;
/**
 * How far the liveness interval may drift before the event loop counts as blocked. The interval
 * fires every second; ten seconds of drift is synchronous work no handler in this worker does.
 */
export const LOOP_STALL_MS = 10_000;
/** Slack over a job's own deadline before "still running" is reported as overdue. */
export const OVERDUE_SLACK_MS = 30_000;

export type Health = {
  ok: boolean;
  reason: string | null;
  workerId: string;
  running: number;
  capacity: number;
  abandoned: number;
  loopLagMs: number;
  pollAgeMs: number;
  lastClaimAt: string | null;
  jobs: { id: string; type: string; ageMs: number; overdueMs: number }[];
};

/**
 * Three failures that the previous single "time since a slot last polled" check could not tell
 * apart (audit §6):
 *   - the event loop is blocked - nothing ticks, nothing recovers, restart is right;
 *   - every slot is held by a handler that ignored its abort - the worker cannot take work again;
 *   - the loop stopped polling while idle - the original stuck check, now only applied when idle.
 * Four legitimately long jobs (a 30-minute crawl) are none of these, and stay healthy.
 */
export function evaluateHealth(state: RuntimeState, now: number = Date.now()): Health {
  const loopLagMs = Math.max(0, now - state.lastLoopAt);
  const pollAgeMs = Math.max(0, now - state.lastTickAt);
  const active = [...state.activeJobs.values()].map((j) => ({
    id: j.id,
    type: j.type,
    ageMs: Math.max(0, now - j.startedAt),
    overdueMs: Math.max(0, now - j.deadlineAt),
  }));
  const overdue = active.filter((j) => j.overdueMs > OVERDUE_SLACK_MS);

  const reason = state.stopping
    ? "stopping"
    : loopLagMs > LOOP_STALL_MS
      ? "event-loop-blocked"
      : state.abandoned >= state.capacity
        ? "no-free-slots"
        : overdue.length > 0
          ? "job-overdue"
          : state.running === 0 && pollAgeMs > STUCK_MS
            ? "poll-stalled"
            : null;

  return {
    ok: reason === null,
    reason,
    workerId: state.workerId,
    running: state.running,
    capacity: state.capacity,
    abandoned: state.abandoned,
    loopLagMs,
    pollAgeMs,
    lastClaimAt: state.lastClaimAt === null ? null : new Date(state.lastClaimAt).toISOString(),
    jobs: active,
  };
}

export function startHealthz(state: RuntimeState, log: Logger, port: number = HEALTHZ_PORT): { stop(): Promise<void> } {
  const server: Server = createServer((req, res) => {
    if (req.url !== "/healthz" && req.url !== "/") {
      res.writeHead(404).end();
      return;
    }
    const health = evaluateHealth(state);
    res.writeHead(health.ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify(health));
  });
  server.listen(port, "127.0.0.1", () => log.info({ port }, "healthz listening"));
  server.on("error", (err) => log.error({ err: err.message }, "healthz server error"));

  return {
    stop() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
