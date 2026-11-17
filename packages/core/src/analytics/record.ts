import { type Db, events } from "@namilux/db";
import type { UaClass } from "../constants";
import type { AnalyticsSamplingSetting, JsonObject } from "../types";
import type { BeaconInput } from "../validation/analytics";

/** mobile | desktop | inapp (Instagram/FB/Line webview) | pwa (standalone display mode). */
export function classifyUa(ua: string, standalone: boolean): UaClass {
  if (standalone) return "pwa";
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter|MicroMessenger/i.test(ua)) return "inapp";
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  return "desktop";
}

/** YYYY-MM-DD in Asia/Tehran. Iran is a fixed UTC+3:30 (DST abolished in 2022), so a constant shift
 *  then the ISO calendar date is exact - and it keeps Intl out of core (no-locale-number rule). */
export function dayKey(d: Date): string {
  return new Date(d.getTime() + 3.5 * 3_600_000).toISOString().slice(0, 10);
}

/** DECISION: sampling drops a fraction of `pv` beacons deterministically by session hash. */
function sampledOut(type: BeaconInput["t"], sessionHash: string, sampling: AnalyticsSamplingSetting): boolean {
  const rate = typeof sampling === "object" && sampling !== null && "pvRate" in sampling ? Number((sampling as { pvRate?: number }).pvRate ?? 1) : 1;
  if (type !== "pv" || rate >= 1) return false;
  let h = 0;
  for (let i = 0; i < sessionHash.length; i += 1) h = (h * 31 + sessionHash.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 >= rate;
}

export const analytics = {
  async record(db: Db, ev: BeaconInput, ctx: { ip: string; ua: string; sampling: AnalyticsSamplingSetting; now?: Date }): Promise<void> {
    const uaClass = classifyUa(ctx.ua, ev.ua === "pwa");
    if (sampledOut(ev.t, ev.s, ctx.sampling)) return;
    try {
      await db.insert(events).values({
        ts: ctx.now ?? new Date(),
        type: ev.t,
        path: ev.p,
        ref: ev.r ?? null,
        productId: ev.pid ?? null,
        sessionHash: ev.s,
        uaClass,
        propsJson: { ...(ev.x ?? {}) },
      });
    } catch {
      // A beacon write must never turn a page into a 500 (the spec fire-and-forget).
    }
  },

  async recordServer(db: Db, type: "purchase" | "order_expired" | "otp_sent" | "sms_sent", props: JsonObject, sessionHash?: string | null): Promise<void> {
    // Server-only signals keep their own types; they must never inflate browser pageviews.
    try {
      await db.insert(events).values({ ts: new Date(), type, path: "", ref: null, productId: null, sessionHash: sessionHash ?? "", uaClass: "desktop", propsJson: { ...props, server: type } });
    } catch {
      // never throw from a side-effect logger
    }
  },

  async searchZeroResult(db: Db, term: string, sessionHash: string): Promise<void> {
    try {
      await db.insert(events).values({ ts: new Date(), type: "search", path: "/search/", ref: null, productId: null, sessionHash, uaClass: "desktop", propsJson: { term, zero: true } });
    } catch {
      // ignore
    }
  },
};
