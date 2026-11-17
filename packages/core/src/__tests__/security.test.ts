import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, jobs as jobsTable, like, securityEvents } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { ALERT_KINDS, ALERT_THRESHOLDS, ALERT_WINDOW_MIN, normalizeEventIp, scrubDetail, security } from "../security";
import { SECURITY_EVENT_KINDS } from "../constants";

const ALERT_KIND = "callback.forged";
const QUIET_KIND = "csp.report";
const JOB_KEY_PREFIX = "security.alert:%";

describe("security.event", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("detail never contains a full phone number or token", () => {
    const scrubbed = scrubDetail({
      phone: "09121230077",
      token: "abcdef",
      otpCode: "123456",
      note: "تماس با 09121230077",
      addressLine: "تهران، خیابان …",
      nested: { sessionToken: "zzz", ok: true, recipientPhone: "09121234567" },
      count: 3,
    });
    expect(scrubbed).toEqual({
      phone: "0912***0077",
      note: "تماس با 0912***0077",
      nested: { ok: true, recipientPhone: "0912***4567" },
      count: 3,
    });
    const serialized = JSON.stringify(scrubbed);
    expect(serialized).not.toContain("09121230077");
    expect(serialized).not.toContain("abcdef");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("خیابان");
  });

  it("caps a long string and drops an oversized detail down to its key names", () => {
    expect(scrubDetail({ blob: "x".repeat(20_000) })).toEqual({ blob: "x".repeat(500) });

    const wide = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, "x".repeat(500)]),
    ) as Record<string, string>;
    const scrubbed = scrubDetail(wide);
    expect(scrubbed.__truncated).toBe(true);
    expect(scrubbed.keys).toEqual(Object.keys(wide));
  });

  it("stores a staff ip in full and everything else as /24", () => {
    expect(normalizeEventIp("192.0.2.10", false)).toBe("192.0.2.0/24");
    expect(normalizeEventIp("192.0.2.10", true)).toBe("192.0.2.10");
    expect(normalizeEventIp("2001:db8:1234:5678::1", false)).toBe("2001:db8:1234::/48");
    expect(normalizeEventIp("'; drop table jobs; --", false)).toBeNull();
    expect(normalizeEventIp(undefined, true)).toBeNull();
  });

  it("alert kinds are a subset of the recorded kinds", () => {
    for (const kind of ALERT_KINDS) expect(SECURITY_EVENT_KINDS).toContain(kind);
    expect(ALERT_THRESHOLDS["staff.login.failed"]).toBe(5);
    expect(ALERT_WINDOW_MIN).toBe(10);
  });

  it("never throws when the insert fails (logs instead)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const brokenDb = {
      insert: () => {
        throw new Error("connection terminated");
      },
    } as unknown as Db;

    await expect(security.event(brokenDb, ALERT_KIND, { authority: "A0" }, "192.0.2.10")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(ALERT_KIND);
    // The failure message never carries the detail or the error text.
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("connection terminated");
  });

  it("ignores a kind that is not in SECURITY_EVENT_KINDS", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const noDb = {
      insert: () => {
        throw new Error("must not be reached");
      },
    } as unknown as Db;
    await security.event(noDb, "made.up" as (typeof SECURITY_EVENT_KINDS)[number], {});
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe.skipIf(!hasTestDb())("security.event (integration)", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("alert kinds enqueue at most one telegram job per kind per 10 minutes", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100");
    await withTestTx(testDb.db, async (tx) => {
      // Rolled back with the rest of the transaction: makes the sliding window deterministic.
      await tx.delete(securityEvents).where(eq(securityEvents.kind, ALERT_KIND));

      await security.event(tx, ALERT_KIND, { authority: "A00000", phone: "09121230077" }, "192.0.2.10", "guest");
      await security.event(tx, ALERT_KIND, { authority: "A00001" }, "192.0.2.11");

      const events = await tx.select().from(securityEvents).where(eq(securityEvents.kind, ALERT_KIND));
      expect(events).toHaveLength(2);
      expect(events[0]?.ip).toBe("192.0.2.0/24");
      expect(events[0]?.actor).toBe("guest");
      expect(JSON.stringify(events[0]?.detailJson)).not.toContain("09121230077");

      const alerts = await tx
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.type, "telegram.notify"), like(jobsTable.uniqueKey, JOB_KEY_PREFIX)));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.uniqueKey).toContain(ALERT_KIND);
      const payload = alerts[0]?.payloadJson as { kind?: string; event?: string };
      expect(payload.kind).toBe("security.alert");
      expect(payload.event).toBe(ALERT_KIND);
    });
  });

  it("a threshold kind waits for the fifth event inside the window", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100");
    await withTestTx(testDb.db, async (tx) => {
      await tx.delete(securityEvents).where(eq(securityEvents.kind, "staff.login.failed"));
      for (let i = 0; i < 4; i += 1) {
        await security.event(tx, "staff.login.failed", { reason: "password" }, "192.0.2.10");
      }
      let alerts = await tx
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.type, "telegram.notify"), like(jobsTable.uniqueKey, JOB_KEY_PREFIX)));
      expect(alerts).toHaveLength(0);

      await security.event(tx, "staff.login.failed", { reason: "password" }, "192.0.2.10");
      alerts = await tx
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.type, "telegram.notify"), like(jobsTable.uniqueKey, JOB_KEY_PREFIX)));
      expect(alerts).toHaveLength(1);

      // A staff event keeps the full address (the spec: an admin action stays attributable).
      const rows = await tx.select().from(securityEvents).where(eq(securityEvents.kind, "staff.login.failed"));
      expect(rows[0]?.ip).toBe("192.0.2.10");
      expect(await security.countRecent(tx, "staff.login.failed", ALERT_WINDOW_MIN)).toBe(5);
      expect(await security.countRecent(tx, "staff.login.failed", 0)).toBe(0);
    });
  });

  it("non-alert kinds store only", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100");
    await withTestTx(testDb.db, async (tx) => {
      await tx.delete(securityEvents).where(eq(securityEvents.kind, QUIET_KIND));
      await security.event(tx, QUIET_KIND, { directive: "img-src" }, "192.0.2.10");

      const events = await tx.select().from(securityEvents).where(eq(securityEvents.kind, QUIET_KIND));
      expect(events).toHaveLength(1);
      const alerts = await tx
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.type, "telegram.notify"), like(jobsTable.uniqueKey, JOB_KEY_PREFIX)));
      expect(alerts).toHaveLength(0);
    });
  });

  it("stores the event but enqueues nothing when telegram is not configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "");
    await withTestTx(testDb.db, async (tx) => {
      await tx.delete(securityEvents).where(eq(securityEvents.kind, ALERT_KIND));
      await security.event(tx, ALERT_KIND, { authority: "A00002" });

      expect(await security.countRecent(tx, ALERT_KIND, ALERT_WINDOW_MIN)).toBe(1);
      const alerts = await tx
        .select()
        .from(jobsTable)
        .where(and(eq(jobsTable.type, "telegram.notify"), like(jobsTable.uniqueKey, JOB_KEY_PREFIX)));
      expect(alerts).toHaveLength(0);
    });
  });

  it("lists events newest first with kind and date filters", async () => {
    await withTestTx(testDb.db, async (tx) => {
      await tx.delete(securityEvents).where(eq(securityEvents.kind, QUIET_KIND));
      await security.event(tx, QUIET_KIND, { directive: "script-src" }, "192.0.2.10");

      const page = await security.list(tx, { kind: QUIET_KIND, page: 1, from: "not-a-date" });
      expect(page.total).toBe(1);
      expect(page.pageSize).toBe(50);
      expect(page.items[0]?.kind).toBe(QUIET_KIND);
      expect(page.items[0]?.detail).toEqual({ directive: "script-src" });
      expect(typeof page.items[0]?.createdAt).toBe("string");

      const future = await security.list(tx, {
        kind: QUIET_KIND,
        from: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(future.total).toBe(0);
    });
  });
});
