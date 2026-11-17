import { type Db, eq, rateLimits } from "@namilux/db";
// DECISION (M0 step 3): OtpLimits is defined once in ../types (settings key "otp.limits").
import type { OtpLimits } from "../types";
import { GLOBAL_KEY, type QuotaRow, effectiveCount } from "./quota";
import { security } from "../security";
import { jobs } from "../jobs";

export type BreakerState = "ok" | "captcha" | "pause";

export function breakerState(sends10m: number, limits: OtpLimits): BreakerState {
  if (sends10m > limits.global10m * limits.pauseMultiplier) return "pause";
  if (sends10m > limits.global10m) return "captcha";
  return "ok";
}

// DECISION: module-level last-observed state so a state CHANGE writes exactly one security event and
// one alert job. The single admin instance makes a process-local variable sufficient.
let lastState: BreakerState = "ok";

export const breaker = {
  async shouldPause(db: Db, limits: OtpLimits): Promise<BreakerState> {
    const now = new Date();
    const rows = (await db
      .select({ key: rateLimits.key, windowStart: rateLimits.windowStart, count: rateLimits.count })
      .from(rateLimits)
      .where(eq(rateLimits.key, GLOBAL_KEY))
      .limit(1)) as QuotaRow[];
    const sends = effectiveCount(rows[0], now);
    const state = breakerState(sends, limits);

    if (state !== lastState) {
      // No "otp.breaker.ok" security kind exists - record only the alarm states; a recovery
      // still updates lastState and enqueues a Telegram notice below.
      if (state !== "ok") {
        await security.event(db, `otp.breaker.${state}`, {
          sends,
          global10m: limits.global10m,
          pauseMultiplier: limits.pauseMultiplier,
        });
      }
      await jobs.enqueue(
        db,
        "telegram.notify",
        { kind: "otp.breaker", state, sends },
        { uniqueKey: `otp.breaker:${state}:${breaker.tenMinuteBucket(now)}` },
      );
      lastState = state;
    }
    return state;
  },
  tenMinuteBucket(now: Date): string {
    return String(Math.floor(now.getTime() / 600_000));
  },
  resetForTests(): void {
    lastState = "ok";
  },
};
