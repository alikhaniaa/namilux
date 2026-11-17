import { jobs } from "@namilux/core";
import type { JobType, JsonObject } from "@namilux/core";
import type { Db } from "@namilux/db";
import type { Logger } from "./logger";

export type Schedule = { type: JobType; every?: number; at?: { hour: number; minute: number; tz: "Asia/Tehran" }; payload?: JsonObject };

const TICK_MS = 30_000;

/**
 * Asia/Tehran is a fixed +03:30 since Iran dropped DST in 2022, so the wall clock is a plain
 * fixed-offset shift of UTC - no Intl (forbidden outside core/persian by the spec) and no DST branch.
 */
const TEHRAN_OFFSET_MIN = 3 * 60 + 30;
const pad2 = (n: number): string => String(n).padStart(2, "0");

function tehranParts(now: Date): { date: string; hour: number; minute: number } {
  const t = new Date(now.getTime() + TEHRAN_OFFSET_MIN * 60_000);
  return {
    date: `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`,
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/**
 * The unique_key suffix for this schedule at `now`, or null when an `at` schedule is not due.
 *   - `every`: the window bucket = floor(epochMs / every) → one enqueue per window.
 *   - `at`:    the Tehran calendar date, only when the current Tehran hour:minute matches → one per day.
 */
export function slotKey(schedule: Schedule, now: Date): string | null {
  if (schedule.every !== undefined && schedule.every > 0) {
    return String(Math.floor(now.getTime() / schedule.every));
  }
  if (schedule.at) {
    const { date, hour, minute } = tehranParts(now);
    if (hour === schedule.at.hour && minute === schedule.at.minute) return date;
    return null;
  }
  return null;
}

export function startScheduler(db: Db, schedules: Schedule[], log: Logger): { stop(): void } {
  async function tick(): Promise<void> {
    const now = new Date();
    for (const schedule of schedules) {
      const slot = slotKey(schedule, now);
      if (slot === null) continue;
      try {
        await jobs.enqueue(db, schedule.type, schedule.payload ?? {}, { uniqueKey: `${schedule.type}:${slot}` });
      } catch (err) {
        log.error({ type: schedule.type, err: err instanceof Error ? err.message : String(err) }, "schedule enqueue failed");
      }
    }
  }
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

export type { JobType, JsonObject };
