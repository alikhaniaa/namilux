import { hostname } from "node:os";
import { jobs } from "@namilux/core";
import type { Db } from "@namilux/db";
import type { Logger } from "./logger";

const VERSION = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function heartbeatMeta(extra: { running: number; uptimeSec: number }): {
  pid: number;
  hostname: string;
  version: string;
  running: number;
  uptimeSec: number;
} {
  return { pid: process.pid, hostname: hostname(), version: VERSION, ...extra };
}

export function startHeartbeat(
  db: Db,
  workerId: string,
  intervalMs: number,
  meta: () => { running: number; uptimeSec: number },
  log: Logger,
): { stop(): void } {
  async function beat(): Promise<void> {
    try {
      await jobs.heartbeat(db, workerId, heartbeatMeta(meta()));
    } catch (err) {
      // A missed heartbeat is a monitoring signal, not a reason to crash the worker.
      log.error({ err: err instanceof Error ? err.message : String(err) }, "heartbeat failed");
    }
  }
  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
