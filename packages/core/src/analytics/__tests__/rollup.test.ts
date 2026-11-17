import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDbAs, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, events, metricsDaily, smsLog, sql } from "@namilux/db";
import { ulid } from "../../ids";
import { SETTINGS, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { analytics, dayKey } from "../record";
import { METRICS, pruneEvents, rollupDay } from "../rollup";

const SAMPLING = SETTINGS["analytics.sampling"];
const SID = "0123456789abcdef";

describe("rollup - pure", () => {
  it("day boundary is Asia/Tehran", () => {
    expect(dayKey(new Date("2026-08-28T20:29:00Z"))).toBe("2026-08-28");
    expect(dayKey(new Date("2026-08-28T20:31:00Z"))).toBe("2026-08-29"); // 00:01 Tehran
    expect(METRICS).toContain("revenue");
  });
});

describe.skipIf(!hasTestDb())("rollup — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
    await truncateAll(handle.db); // counts are absolute: start from an empty events table
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function pv(path: string, now: Date, sid = SID): Promise<void> {
    await analytics.record(handle.db, { t: "pv", p: path, s: sid, ua: "mobile" }, { ip: "1.2.3.4", ua: "Mozilla/5.0 (Linux; Android 14) Mobile", sampling: SAMPLING, now });
  }

  async function metric(day: string, name: string, dim = ""): Promise<number> {
    const rows = await handle.db.select({ value: metricsDaily.value }).from(metricsDaily).where(eq(metricsDaily.day, day));
    const all = await handle.db.select().from(metricsDaily).where(eq(metricsDaily.day, day));
    void rows;
    const hit = all.find((r) => r.metric === name && r.dim === dim);
    return hit === undefined ? Number.NaN : Number(hit.value);
  }

  it("rerun for the same day is idempotent", async () => {
    const now = new Date();
    const day = dayKey(now);
    await pv("/", now);
    await pv("/shop/", now);
    const first = await rollupDay(handle.db, day);
    const rowsA = await handle.db.select().from(metricsDaily).where(eq(metricsDaily.day, day));
    const second = await rollupDay(handle.db, day);
    const rowsB = await handle.db.select().from(metricsDaily).where(eq(metricsDaily.day, day));
    expect(second.metrics).toBe(first.metrics);
    expect(rowsB).toHaveLength(rowsA.length);
    expect(await metric(day, "pageviews")).toBe(2);
    expect(await metric(day, "sessions")).toBe(1);
    expect(await metric(day, "top_pages", "/")).toBe(1);
  });

  it("worker records server signals without inflating visits and cannot mutate analytics history", async () => {
    const worker = await createTestDbAs("worker");
    try {
      await analytics.recordServer(worker.db, "sms_sent", { template: "product.back_in_stock", server: "pv" });
      await analytics.recordServer(worker.db, "otp_sent", {});
      const recorded = await worker.db.select().from(events);
      expect(recorded.map((row) => row.type).sort()).toEqual(["otp_sent", "sms_sent"]);
      expect(recorded.find((row) => row.type === "sms_sent")?.propsJson?.["server"]).toBe("sms_sent");
      await expect(worker.db.execute(sql`update events set path = '/bad'`)).rejects.toThrow();
      await expect(worker.db.execute(sql`delete from events`)).rejects.toThrow();
      const now = new Date();
      await pv("/", now);
      await rollupDay(worker.db, dayKey(now));
      expect(await metric(dayKey(now), "pageviews")).toBe(1);
      expect(await metric(dayKey(now), "sessions")).toBe(1);
      expect(await metric(dayKey(now), "sms_sent")).toBe(0);
    } finally { await worker.close(); }
  });

  it("counts successful SMS/OTP log rows once, excluding failed, budget-blocked and other-day sends", async () => {
    const now = new Date();
    for (const [template, status, createdAt] of [
      ["otp", "sent", now], ["product.back_in_stock", "sent", now],
      ["otp", "failed", now], ["order.placed", "failed", now],
      ["order.placed", "sent", new Date(now.getTime() - 86_400_000)],
    ] as const) {
      await handle.db.insert(smsLog).values({ id: ulid(), toMasked: "09***0000", toHash: "fixture", provider: "mock", template, status, createdAt });
    }
    await analytics.recordServer(handle.db, "sms_sent", { count: 100 });
    await rollupDay(handle.db, dayKey(now));
    expect(await metric(dayKey(now), "sms_sent")).toBe(1);
    expect(await metric(dayKey(now), "otp_sent")).toBe(1);
    expect(await metric(dayKey(now), "pageviews")).toBe(0);
    expect(await metric(dayKey(now), "sessions")).toBe(0);
  });

  it("revenue comes from orders not beacons", async () => {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const now = new Date();
    const day = dayKey(now);
    const order = await paidOrder(handle.db, { productId: seed.productId, customerId: seed.customerId }, actor);
    // a purchase beacon claiming a different amount must not influence revenue
    await analytics.record(handle.db, { t: "purchase", p: "/billing/result/", s: SID, ua: "mobile", x: { amount: 1 } }, { ip: "1.2.3.4", ua: "test", sampling: SAMPLING, now });
    await pv("/", now);
    await rollupDay(handle.db, day);
    expect(await metric(day, "revenue")).toBe(order.grandTotal);
    expect(await metric(day, "purchases")).toBe(1);
    expect(await metric(day, "aov")).toBe(order.grandTotal);
    expect(await metric(day, "conversion")).toBe(1);
    expect(await metric(day, "top_products", String(seed.productId))).toBe(1);
  });

  it("day boundary is Asia/Tehran", async () => {
    // 20:31 UTC is already 00:01 of the next day in Tehran: the event belongs to the next day's
    // rollup only. The instant is a few days ahead so it lands in a partition the migration has
    // created (only the current month and the months ahead exist) and on days no other test uses.
    const at = new Date(Date.now() + 5 * 86_400_000);
    at.setUTCHours(20, 31, 0, 0);
    const utcDay = at.toISOString().slice(0, 10);
    const tehranDay = dayKey(at);
    expect(tehranDay).not.toBe(utcDay);
    await pv("/", at);
    await rollupDay(handle.db, utcDay);
    await rollupDay(handle.db, tehranDay);
    expect(await metric(utcDay, "pageviews")).toBe(0);
    expect(await metric(tehranDay, "pageviews")).toBe(1);
  });

  it("prune drops only partitions older than retention", async () => {
    const now = new Date();
    const current = `events_${String(now.getUTCFullYear())}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    await handle.db.execute(sql`create table if not exists events_202001 partition of events for values from ('2020-01-01') to ('2020-02-01')`);
    const res = await pruneEvents(handle.db, 12, now);
    expect(res.droppedPartitions).toHaveLength(1);
    const names = (await handle.db.execute<{ relname: string }>(sql`select relname from pg_class where relname ~ '^events_[0-9]{6}$'`)).map((r) => r.relname);
    expect(names).not.toContain("events_202001");
    expect(names).toContain(current);
    // nothing else is old enough on a rerun
    expect((await pruneEvents(handle.db, 12, now)).droppedPartitions).toHaveLength(0);
  });
});
