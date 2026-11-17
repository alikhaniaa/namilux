import { auditLog, customers, orders, payments, type Db } from "@namilux/db";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { NATURAL_KEYS, SEED_ACTOR, SEED_TABLES, SeedAbort, assertTablesExist, guardAgainstLiveData, inChunks } from "../idempotency.js";

type Counts = { orders?: number; customers?: number; staffAudit?: number; payments?: number };

type CountRows = { n: number }[];

function rows(n: number): Promise<CountRows> & { where: () => Promise<CountRows> } {
  const p = Promise.resolve([{ n }]) as Promise<CountRows> & { where: () => Promise<CountRows> };
  p.where = () => p;
  return p;
}

function fakeDb(counts: Counts): Db {
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === orders) return rows(counts.orders ?? 0);
        if (table === customers) return rows(counts.customers ?? 0);
        if (table === payments) return rows(counts.payments ?? 0);
        if (table === auditLog) return rows(counts.staffAudit ?? 0);
        throw new Error("the guard queried an unexpected table");
      },
    }),
  };
  return db as unknown as Db;
}

function fakeExecuteDb(present: readonly string[]): Db {
  return { execute: () => Promise.resolve(present.map((t) => ({ table_name: t }))) } as unknown as Db;
}

function fakeLog(): Logger & { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() } as unknown as Logger & { warn: ReturnType<typeof vi.fn> };
}

describe("SEED_ACTOR", () => {
  it("is the system actor with no id", () => {
    expect(SEED_ACTOR).toEqual({ type: "system", id: null });
  });

  it("SEED_TABLES lists every natural key table", () => {
    expect(SEED_TABLES).toEqual(Object.keys(NATURAL_KEYS));
    expect(SEED_TABLES).toContain("products");
    expect(SEED_TABLES).toContain("redirects");
  });
});

describe("guardAgainstLiveData", () => {
  it("fresh db passes", async () => {
    const log = fakeLog();
    await expect(guardAgainstLiveData(fakeDb({}), { force: false, log })).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("aborts on customers>0", async () => {
    const log = fakeLog();
    const err = await guardAgainstLiveData(fakeDb({ orders: 0, customers: 1 }), { force: false, log }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SeedAbort);
    expect((err as SeedAbort).code).toBe("LIVE_DATA");
    expect((err as SeedAbort).message).toContain("customers=1");
    expect((err as SeedAbort).message).not.toContain("orders=");
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("aborts on orders, staff audit rows or payments too", async () => {
    const log = fakeLog();
    for (const counts of [{ orders: 3 }, { staffAudit: 2 }, { payments: 1 }] satisfies Counts[]) {
      await expect(guardAgainstLiveData(fakeDb(counts), { force: false, log })).rejects.toBeInstanceOf(SeedAbort);
    }
  });

  it("force logs and proceeds", async () => {
    const log = fakeLog();
    await expect(guardAgainstLiveData(fakeDb({ customers: 1, staffAudit: 4 }), { force: true, log })).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls.map((c) => (c[0] as { table: string }).table)).toEqual(["customers", "audit_log(staff)"]);
    expect(log.warn.mock.calls[0]?.[1]).toContain("--force");
  });
});

describe("assertTablesExist", () => {
  it("passes when every table is present", async () => {
    await expect(assertTablesExist(fakeExecuteDb(["products", "brands", "extra"]), ["products", "brands"])).resolves.toBeUndefined();
  });

  it("names the missing tables and tells the operator to migrate", async () => {
    const err = await assertTablesExist(fakeExecuteDb(["products"]), ["products", "redirects", "media"]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SeedAbort);
    expect((err as SeedAbort).code).toBe("MISSING_TABLE");
    expect((err as SeedAbort).message).toContain("redirects, media");
    expect((err as SeedAbort).message).toContain("db:migrate");
  });
});

describe("inChunks", () => {
  it("inChunks preserves order and sizes", async () => {
    const input = [1, 2, 3, 4, 5, 6, 7];
    const seen: number[][] = [];
    await inChunks(input, 3, async (chunk) => {
      seen.push(chunk);
    });
    expect(seen).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
    expect(seen.flat()).toEqual(input);
  });

  it("runs chunks sequentially, never overlapping", async () => {
    let running = 0;
    let maxConcurrent = 0;
    await inChunks([1, 2, 3, 4], 2, async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(maxConcurrent).toBe(1);
  });

  it("never calls the writer for an empty list", async () => {
    const fn = vi.fn(async () => {});
    await inChunks([], 10, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("falls back to 200 for a non-positive size instead of looping forever", async () => {
    const seen: number[][] = [];
    const input = Array.from({ length: 201 }, (_, i) => i);
    await inChunks(input, 0, async (chunk) => {
      seen.push(chunk);
    });
    expect(seen.map((c) => c.length)).toEqual([200, 1]);
  });
});

// The remaining test the header lists is an integration test: it needs a migrated database
// (DATABASE_URL_TEST) and the catalog importer that writes price_history - neither exists in this
// batch, and vitest.config.ts forbids unit tests from touching a database. It is covered by the M0
// gate (`pnpm db:seed` twice) until the importer batch lands.
it.todo("second seed adds no price_history row (integration, DATABASE_URL_TEST)");
