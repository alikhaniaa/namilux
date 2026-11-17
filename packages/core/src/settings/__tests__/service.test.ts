import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { Db } from "@namilux/db";
import { settings as settingsTable } from "@namilux/db";

// DECISION: `../../audit` is mocked, not implemented here - audit.ts is a separate spec header with
// its own tests, and core may not implement a file it was not given. The mock records the exact
// argument list the audit contract fixes.
const { auditLog } = vi.hoisted(() => ({ auditLog: vi.fn(() => Promise.resolve()) }));
vi.mock("../../audit", () => ({ audit: { log: auditLog } }));

import { SETTINGS_CACHE_TTL_MS } from "../../constants";
import { isAppError } from "../../errors";
import { DEFAULT_SETTINGS } from "../schema";
import type { Settings } from "../schema";
import { effectiveFlags, getSetting, getSettings, invalidateSettingsCache, setSetting } from "../service";

// ---------------------------------------------------------------- Db stub
type StubRow = { key: string; valueJson: unknown };
type InsertedRow = { key: string; valueJson: unknown; updatedBy: string | null };
type StubState = { selects: number; transactions: number; inserted: InsertedRow[] };

/**
 * The smallest handle service.ts uses: `select().from()` (awaited → every row) and
 * `select().from().where().limit(n)` (the single-key read). The stub ignores the WHERE predicate - 
 * it is handed exactly the row under test; the real predicate is exercised by the DB block below.
 */
function stubDb(rows: StubRow[]): { db: Db; state: StubState } {
  const state: StubState = { selects: 0, transactions: 0, inserted: [] };
  const handle = {
    select: (): unknown => {
      state.selects += 1;
      const all = rows.map((row) => ({ ...row }));
      const fromResult = {
        where: () => ({ limit: (n: number) => Promise.resolve(all.slice(0, n)) }),
        then: (onOk: (value: StubRow[]) => unknown, onErr: (reason: unknown) => unknown) =>
          Promise.resolve(all).then(onOk, onErr),
      };
      return { from: () => fromResult };
    },
    insert: (): unknown => ({
      values: (values: InsertedRow) => ({
        onConflictDoUpdate: () => {
          state.inserted.push(values);
          // behave like the real upsert so a second read sees the new value
          const at = rows.findIndex((row) => row.key === values.key);
          const stored = { key: values.key, valueJson: values.valueJson };
          if (at === -1) rows.push(stored);
          else rows[at] = stored;
          return Promise.resolve();
        },
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      state.transactions += 1;
      return fn(handle);
    },
  };
  return { db: handle as unknown as Db, state };
}

const staff: { type: "staff"; id: string } = { type: "staff", id: "01JSTAFF0000000000000000AA" };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  invalidateSettingsCache();
  auditLog.mockClear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("getSettings", () => {
  it("fresh database returns DEFAULT_SETTINGS", async () => {
    const { db } = stubDb([]);
    await expect(getSettings(db)).resolves.toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("never hands out the DEFAULT_SETTINGS objects themselves", async () => {
    const { db } = stubDb([]);
    const loaded = await getSettings(db);
    expect(loaded["store.info"]).not.toBe(DEFAULT_SETTINGS["store.info"]);
    loaded["store.info"].brandName = "mutated";
    expect(DEFAULT_SETTINGS["store.info"].brandName).toBe("نامی لوکس");
  });

  it("stored rows override the defaults key by key", async () => {
    const { db } = stubDb([
      { key: "commerce.vat_percent", valueJson: 9 },
      { key: "commerce.maintenance", valueJson: { enabled: true, message: "به‌زودی برمی‌گردیم" } },
    ]);
    const loaded = await getSettings(db);
    expect(loaded["commerce.vat_percent"]).toBe(9);
    expect(loaded["commerce.maintenance"]).toEqual({ enabled: true, message: "به‌زودی برمی‌گردیم" });
    expect(loaded["commerce.max_per_order"]).toBe(DEFAULT_SETTINGS["commerce.max_per_order"]);
  });

  it("bad stored json falls back to the default and warns", async () => {
    const { db } = stubDb([
      { key: "commerce.max_per_order", valueJson: 99 },
      { key: "flags", valueJson: "not-an-object" },
      { key: "commerce.vat_percent", valueJson: 9 },
    ]);
    const loaded = await getSettings(db);
    expect(loaded["commerce.max_per_order"]).toBe(DEFAULT_SETTINGS["commerce.max_per_order"]);
    expect(loaded.flags).toEqual(DEFAULT_SETTINGS.flags);
    expect(loaded["commerce.vat_percent"]).toBe(9);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("commerce.max_per_order");
    // the value itself is never logged
    for (const call of warnSpy.mock.calls) expect(String(call[0])).not.toContain("99");
  });

  it("an unknown row key is ignored with a warning, not a crash", async () => {
    const { db } = stubDb([{ key: "store.legacy\nINJECTED", valueJson: 1 }]);
    const loaded = await getSettings(db);
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // the key is JSON-escaped, so a hostile row cannot forge a second log line
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("\\n");
  });

  it("memoizes for SETTINGS_CACHE_TTL_MS and reloads afterwards", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T08:00:00.000Z"));
    const { db, state } = stubDb([]);
    await getSettings(db);
    await getSettings(db);
    expect(state.selects).toBe(1);
    vi.advanceTimersByTime(SETTINGS_CACHE_TTL_MS - 1);
    await getSettings(db);
    expect(state.selects).toBe(1);
    vi.advanceTimersByTime(2);
    await getSettings(db);
    expect(state.selects).toBe(2);
  });

  it("invalidateSettingsCache drops the memo", async () => {
    const { db, state } = stubDb([]);
    await getSettings(db);
    invalidateSettingsCache();
    await getSettings(db);
    expect(state.selects).toBe(2);
  });
});

describe("getSetting", () => {
  it("returns one key from the same memo", async () => {
    const { db, state } = stubDb([{ key: "commerce.max_per_order", valueJson: 3 }]);
    await expect(getSetting(db, "commerce.max_per_order")).resolves.toBe(3);
    await expect(getSetting(db, "commerce.checkout_enabled")).resolves.toBe(true);
    expect(state.selects).toBe(1);
  });
});

describe("setSetting", () => {
  it("setSetting writes an audit row with before/after", async () => {
    const { db, state } = stubDb([{ key: "commerce.vat_percent", valueJson: 9 }]);
    const result = await setSetting(db, "commerce.vat_percent", 12, staff);
    expect(result).toEqual({ tags: ["settings"] });
    expect(state.inserted).toEqual([
      { key: "commerce.vat_percent", valueJson: 12, updatedBy: staff.id },
    ]);
    expect(auditLog).toHaveBeenCalledTimes(1);
    const call = auditLog.mock.calls[0] as unknown as unknown[];
    expect(call.slice(1)).toEqual([staff, "settings.update", "settings", "commerce.vat_percent", 9, 12]);
    // the upsert and its audit row share one transaction
    expect(state.transactions).toBe(1);
  });

  it("before is the default when the key has no row yet", async () => {
    const { db, state } = stubDb([]);
    await setSetting(db, "commerce.max_per_order", 7, { type: "system", id: null });
    expect(state.inserted[0]?.updatedBy).toBe("system");
    const call = auditLog.mock.calls[0] as unknown as unknown[];
    expect(call[5]).toBe(DEFAULT_SETTINGS["commerce.max_per_order"]);
    expect(call[6]).toBe(7);
  });

  it("identical write is a no-op", async () => {
    const { db, state } = stubDb([{ key: "promo.bar", valueJson: { rotateSec: 8, enabled: true } }]);
    // key order differs from the schema's: jsonb reorders, so the comparison is structural
    const result = await setSetting(db, "promo.bar", { enabled: true, rotateSec: 8 }, staff);
    expect(result).toEqual({ tags: [] });
    expect(state.inserted).toEqual([]);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("a corrupt stored row is rewritten even when it looks identical to the default", async () => {
    const { db, state } = stubDb([{ key: "commerce.max_per_order", valueJson: 999 }]);
    await setSetting(db, "commerce.max_per_order", DEFAULT_SETTINGS["commerce.max_per_order"], staff);
    expect(state.inserted).toHaveLength(1);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it("memo is invalidated after a write in the same process", async () => {
    const { db, state } = stubDb([{ key: "commerce.vat_percent", valueJson: 9 }]);
    await expect(getSetting(db, "commerce.vat_percent")).resolves.toBe(9);
    await setSetting(db, "commerce.vat_percent", 10, staff);
    const selectsBefore = state.selects;
    await expect(getSetting(db, "commerce.vat_percent")).resolves.toBe(10);
    expect(state.selects).toBe(selectsBefore + 1);
  });

  it("two writes to the same key: last value wins, both audit rows are kept", async () => {
    const { db, state } = stubDb([{ key: "commerce.vat_percent", valueJson: 9 }]);
    await setSetting(db, "commerce.vat_percent", 10, staff);
    await setSetting(db, "commerce.vat_percent", 11, staff);
    expect(state.inserted.map((row) => row.valueJson)).toEqual([10, 11]);
    expect(auditLog).toHaveBeenCalledTimes(2);
    expect((auditLog.mock.calls[1] as unknown as unknown[]).slice(5)).toEqual([10, 11]);
    await expect(getSetting(db, "commerce.vat_percent")).resolves.toBe(11);
  });

  it("store.* / promo.* / seo.* also revalidate home and nav", async () => {
    for (const key of ["store.contact", "promo.bar", "seo.defaults"] as const) {
      const { db } = stubDb([]);
      const { tags } = await setSetting(db, key, DEFAULT_SETTINGS[key], staff);
      expect(tags, key).toEqual(["settings", "home", "nav"]);
    }
    const { db } = stubDb([]);
    const { tags } = await setSetting(db, "flags", DEFAULT_SETTINGS.flags, staff);
    expect(tags).toEqual(["settings"]);
  });

  it("an unknown key is rejected with VALIDATION and never written", async () => {
    const { db, state } = stubDb([]);
    let thrown: unknown;
    try {
      await setSetting(db, "store.nope" as keyof Settings, 1, staff);
    } catch (err) {
      thrown = err;
    }
    expect(isAppError(thrown)).toBe(true);
    if (isAppError(thrown)) expect(thrown.code).toBe("VALIDATION");
    expect(state.inserted).toEqual([]);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("an out-of-range value is rejected with VALIDATION and never written", async () => {
    const { db, state } = stubDb([]);
    await expect(setSetting(db, "commerce.vat_percent", 30, staff)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(state.inserted).toEqual([]);
  });

  it("a customer or worker actor is rejected with FORBIDDEN before anything is read", async () => {
    for (const actor of [
      { type: "customer" as const, id: "01JCUST0000000000000000AA" },
      { type: "worker" as const, id: null },
    ]) {
      const { db, state } = stubDb([]);
      await expect(setSetting(db, "commerce.vat_percent", 9, actor)).rejects.toMatchObject({
        code: "FORBIDDEN",
        httpStatus: 403,
      });
      expect(state.selects).toBe(0);
      expect(state.inserted).toEqual([]);
      expect(auditLog).not.toHaveBeenCalled();
    }
  });
});

describe("effectiveFlags", () => {
  const open: Settings = structuredClone(DEFAULT_SETTINGS);
  const closed: Settings = structuredClone(DEFAULT_SETTINGS);
  closed["commerce.checkout_enabled"] = false;
  closed["commerce.maintenance"] = { enabled: true, message: "به‌زودی برمی‌گردیم" };

  it("env CHECKOUT_ENABLED=0 overrides a true setting", () => {
    expect(effectiveFlags(open, { CHECKOUT_ENABLED: "0" }).checkoutEnabled).toBe(false);
    expect(effectiveFlags(open, {}).checkoutEnabled).toBe(true);
    expect(effectiveFlags(closed, { CHECKOUT_ENABLED: "1" }).checkoutEnabled).toBe(true);
  });

  it("env MAINTENANCE=1 overrides a false setting and keeps the settings message", () => {
    const flags = effectiveFlags(open, { MAINTENANCE: "1" });
    expect(flags.maintenance).toBe(true);
    expect(flags.maintenanceMessage).toBe(DEFAULT_SETTINGS["commerce.maintenance"].message);
    expect(effectiveFlags(closed, { MAINTENANCE: "0" }).maintenance).toBe(false);
  });

  it("takes the parsed boolean env of @namilux/config as well as the raw strings", () => {
    // packages/config env.ts narrows CHECKOUT_ENABLED/MAINTENANCE to booleans before the app passes
    // them on (apps/web/src/server/loaders/settings.ts)
    for (const off of [false, "0", "false"] as const) {
      expect(effectiveFlags(open, { CHECKOUT_ENABLED: off }).checkoutEnabled, String(off)).toBe(false);
      expect(effectiveFlags(closed, { MAINTENANCE: off }).maintenance, String(off)).toBe(false);
    }
    for (const on of [true, "1", "true"] as const) {
      expect(effectiveFlags(closed, { CHECKOUT_ENABLED: on }).checkoutEnabled, String(on)).toBe(true);
      expect(effectiveFlags(open, { MAINTENANCE: on }).maintenance, String(on)).toBe(true);
    }
  });

  it("an unrecognised value leaves the settings in charge", () => {
    for (const value of ["", "yes", "01", "TRUE"]) {
      expect(effectiveFlags(open, { CHECKOUT_ENABLED: value }).checkoutEnabled, value).toBe(true);
      expect(effectiveFlags(closed, { CHECKOUT_ENABLED: value }).checkoutEnabled, value).toBe(false);
      expect(effectiveFlags(closed, { MAINTENANCE: value }).maintenance, value).toBe(true);
    }
  });

  it("an explicitly undefined property is not an override (exactOptionalPropertyTypes)", () => {
    expect(effectiveFlags(open, { CHECKOUT_ENABLED: undefined, MAINTENANCE: undefined })).toEqual({
      checkoutEnabled: true,
      maintenance: false,
      maintenanceMessage: DEFAULT_SETTINGS["commerce.maintenance"].message,
    });
  });

  it("reads the whole flag set from the settings when no env is set", () => {
    expect(effectiveFlags(closed, {})).toEqual({
      checkoutEnabled: false,
      maintenance: true,
      maintenanceMessage: "به‌زودی برمی‌گردیم",
    });
  });
});

// ---------------------------------------------------------------- integration (DATABASE_URL_TEST)
describe.skipIf(!hasTestDb())("settings service against Postgres", () => {
  it("[db] round-trips a write through the real settings table", async () => {
    const test = await createTestDb({ migrate: false });
    try {
      await withTestTx(test.db, async (tx) => {
        invalidateSettingsCache();
        const before = await getSettings(tx);
        // an empty table gives the defaults; a seeded one gives its rows - either way a valid value
        expect(typeof before["commerce.max_per_order"]).toBe("number");

        const { tags } = await setSetting(tx, "commerce.max_per_order", 4, staff);
        expect(tags).toEqual(["settings"]);
        expect(auditLog).toHaveBeenCalledTimes(1);

        const after = await getSettings(tx);
        expect(after["commerce.max_per_order"]).toBe(4);

        const rows = await tx
          .select({ key: settingsTable.key, valueJson: settingsTable.valueJson })
          .from(settingsTable);
        expect(rows.find((r) => r.key === "commerce.max_per_order")?.valueJson).toBe(4);

        // a second identical write is a no-op even after a real jsonb round-trip
        invalidateSettingsCache();
        auditLog.mockClear();
        const again = await setSetting(tx, "commerce.max_per_order", 4, staff);
        expect(again).toEqual({ tags: [] });
        expect(auditLog).not.toHaveBeenCalled();
      });
    } finally {
      invalidateSettingsCache();
      await test.close();
    }
  }, 30_000);
});
