import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ROLE_LIMITS,
  assertLocalDatabase,
  closeDb,
  createDb,
  getDb,
  pingDb,
  redactDbUrl,
} from "../client";
import type { TestDb } from "../test/helper";
import {
  TEST_PHONE,
  createTestDb,
  createTestDbAs,
  hasTestDb,
  seedMinimal,
  testUrlForRole,
  truncateAll,
  withTestTx,
} from "../test/helper";

const LOCAL_TEST_URL = "postgres://nl_migrate:pw@127.0.0.1:5432/namilux_test";

describe("ROLE_LIMITS", () => {
  it("ROLE_LIMITS matches the spec", () => {
    expect(ROLE_LIMITS.web).toEqual({
      pgRole: "nl_web",
      envVar: "DATABASE_URL_WEB",
      poolMax: 10,
      statementTimeoutMs: 5_000,
      lockTimeoutMs: 3_000,
      idleInTxTimeoutMs: 10_000,
      connectTimeoutSec: 10,
    });
    expect(ROLE_LIMITS.admin.statementTimeoutMs).toBe(30_000);
    expect(ROLE_LIMITS.admin.pgRole).toBe("nl_admin");
    expect(ROLE_LIMITS.worker.statementTimeoutMs).toBe(300_000);
    expect(ROLE_LIMITS.worker.pgRole).toBe("nl_worker");
    expect(ROLE_LIMITS.migrate.statementTimeoutMs).toBe(0);
    expect(ROLE_LIMITS.migrate.lockTimeoutMs).toBe(0);
    expect(ROLE_LIMITS.migrate.idleInTxTimeoutMs).toBe(0);
  });

  it("pool sizes sum below Postgres max_connections 60 with two web containers", () => {
    const total =
      2 * ROLE_LIMITS.web.poolMax +
      ROLE_LIMITS.admin.poolMax +
      ROLE_LIMITS.worker.poolMax +
      ROLE_LIMITS.migrate.poolMax;
    expect(total).toBeLessThan(60);
  });
});

describe("createDb / getDb / closeDb", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("createDb throws on missing env", () => {
    delete process.env.DATABASE_URL_WEB;
    expect(() => createDb("web")).toThrow("DATABASE_URL_WEB is not set");
  });

  it("createDb throws on unknown role", () => {
    expect(() => createDb("nope" as never)).toThrow("unknown db role");
  });

  it("createDb prefers opts.url over env", async () => {
    process.env.DATABASE_URL_WEB = "postgres://ignored:x@127.0.0.1:5432/ignored";
    const db = createDb("web", { url: LOCAL_TEST_URL });
    try {
      const hosts = db.$client.options.host;
      expect(hosts[0]).toBe("127.0.0.1");
      expect(db.$client.options.database).toBe("namilux_test");
    } finally {
      await closeDb(db);
    }
  });

  it("getDb returns a singleton per role", async () => {
    const a = getDb("worker", { url: LOCAL_TEST_URL });
    const b = getDb("worker");
    expect(b).toBe(a);
    await closeDb(a);
  });

  it("getDb ignores opts on the second call", async () => {
    const a = getDb("admin", { url: LOCAL_TEST_URL, applicationName: "first" });
    const b = getDb("admin", { url: "postgres://other:x@127.0.0.1:5432/other", applicationName: "second" });
    expect(b).toBe(a);
    expect(a.$client.options.database).toBe("namilux_test");
    await closeDb(a);
  });

  it("closeDb is idempotent", async () => {
    const db = createDb("migrate", { url: LOCAL_TEST_URL });
    await closeDb(db);
    await expect(closeDb(db)).resolves.toBeUndefined();
  });
});

describe("assertLocalDatabase / redactDbUrl", () => {
  it("assertLocalDatabase accepts localhost/127.0.0.1/::1/db/postgres", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "db", "postgres"]) {
      expect(() => assertLocalDatabase(`postgres://u:p@${host}:5432/namilux`)).not.toThrow();
    }
  });

  it("assertLocalDatabase rejects remote host", () => {
    expect(() => assertLocalDatabase("postgres://u:p@db.example.com:5432/namilux")).toThrow(
      "refusing to run against a non-local database: db.example.com",
    );
  });

  it("assertLocalDatabase rejects garbage", () => {
    expect(() => assertLocalDatabase("not a url at all")).toThrow(
      "refusing to run against a non-local database",
    );
  });

  it("redactDbUrl hides the password", () => {
    expect(redactDbUrl("postgres://nl_web:s3cr3t@127.0.0.1:5432/namilux")).toBe(
      "postgres://nl_web:***@127.0.0.1:5432/namilux",
    );
  });

  it("redactDbUrl leaves a URL without password unchanged", () => {
    expect(redactDbUrl("postgres://nl_web@127.0.0.1:5432/namilux")).toBe(
      "postgres://nl_web@127.0.0.1:5432/namilux",
    );
    expect(redactDbUrl("postgres://127.0.0.1:5432/namilux")).toBe("postgres://127.0.0.1:5432/namilux");
  });
});

describe("test helper", () => {
  it("testUrlForRole swaps credentials only", () => {
    const saved = process.env.DATABASE_URL_WEB;
    process.env.DATABASE_URL_WEB = "postgres://nl_web:webpw@10.0.0.9:6432/namilux";
    try {
      const url = new URL(
        testUrlForRole("web", "postgres://nl_migrate:mig@127.0.0.1:5432/namilux_test"),
      );
      expect(url.username).toBe("nl_web");
      expect(url.password).toBe("webpw");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.port).toBe("5432");
      expect(url.pathname).toBe("/namilux_test");
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL_WEB;
      else process.env.DATABASE_URL_WEB = saved;
    }
  });

  it("createTestDb refuses the dev database name", async () => {
    const saved = process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL_TEST = "postgres://nl_migrate:pw@127.0.0.1:5432/namilux";
    try {
      await expect(createTestDb({ migrate: false })).rejects.toThrow(
        "DATABASE_URL_TEST must not target the dev database",
      );
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL_TEST;
      else process.env.DATABASE_URL_TEST = saved;
    }
  });
});

describe.skipIf(!hasTestDb())("[db] client and helper against DATABASE_URL_TEST", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  afterEach(async () => {
    await truncateAll(handle.db);
  });

  it("[db] createTestDb migrates and connects", async () => {
    const rows = (await handle.db.execute(
      sql`select to_regclass('public.products') is not null as present`,
    )) as unknown as { present: boolean }[];
    expect(rows[0]?.present).toBe(true);
  });

  it("[db] connection has statement_timeout of its role", async () => {
    const migrateRows = (await handle.db.execute(sql`show statement_timeout`)) as unknown as {
      statement_timeout: string;
    }[];
    expect(migrateRows[0]?.statement_timeout).toBe("0");

    const web = await createTestDbAs("web");
    try {
      const rows = (await web.db.execute(sql`show statement_timeout`)) as unknown as {
        statement_timeout: string;
      }[];
      expect(rows[0]?.statement_timeout).toBe("5s");
    } finally {
      await web.close();
    }
  });

  it("[db] connection has search_path = public", async () => {
    const rows = (await handle.db.execute(sql`show search_path`)) as unknown as {
      search_path: string;
    }[];
    expect(rows[0]?.search_path).toBe("public");
  });

  it("[db] pingDb returns the role name and a latency", async () => {
    const ping = await pingDb(handle.db);
    expect(ping.ok).toBe(true);
    expect(ping.role).toBe("nl_migrate");
    expect(ping.ms).toBeGreaterThanOrEqual(0);
  });

  it("[db] createTestDbAs('web') connects as nl_web", async () => {
    const web = await createTestDbAs("web");
    try {
      const ping = await pingDb(web.db);
      expect(ping.role).toBe("nl_web");
    } finally {
      await web.close();
    }
  });

  it("[db] truncateAll empties every table", async () => {
    await seedMinimal(handle.db);
    const before = (await handle.db.execute(sql`select count(*)::int as n from products`)) as unknown as {
      n: number;
    }[];
    expect(before[0]?.n).toBe(1);

    await truncateAll(handle.db);

    const after = (await handle.db.execute(sql`select count(*)::int as n from products`)) as unknown as {
      n: number;
    }[];
    expect(after[0]?.n).toBe(0);
    const customers = (await handle.db.execute(
      sql`select count(*)::int as n from customers`,
    )) as unknown as { n: number }[];
    expect(customers[0]?.n).toBe(0);
  });

  it("[db] withTestTx rolls back", async () => {
    const result = await withTestTx(handle.db, async (tx) => {
      await tx.execute(
        sql`insert into brands (slug, name_fa, name_en) values ('rollback', 'X', 'X')`,
      );
      return "done";
    });
    expect(result).toBe("done");
    const rows = (await handle.db.execute(
      sql`select count(*)::int as n from brands where slug = 'rollback'`,
    )) as unknown as { n: number }[];
    expect(rows[0]?.n).toBe(0);
  });

  it("[db] withTestTx rethrows", async () => {
    await expect(
      withTestTx(handle.db, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("[db] seedMinimal is idempotent", async () => {
    const first = await seedMinimal(handle.db);
    const second = await seedMinimal(handle.db);
    expect(second).toEqual(first);

    const counts = (await handle.db.execute(
      sql`select
            (select count(*)::int from products) as products,
            (select count(*)::int from customers) as customers,
            (select count(*)::int from inventory_movements) as movements,
            (select stock_qty from products where slug = 'test-product') as stock`,
    )) as unknown as { products: number; customers: number; movements: number; stock: number }[];
    expect(counts[0]?.products).toBe(1);
    expect(counts[0]?.customers).toBe(1);
    expect(counts[0]?.movements).toBe(1);
    expect(counts[0]?.stock).toBe(3);

    const phone = (await handle.db.execute(
      sql`select phone from customers limit 1`,
    )) as unknown as { phone: string }[];
    expect(phone[0]?.phone).toBe(TEST_PHONE);
  });
});
