import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  main as migrateMain,
  runMigrations,
} from "../../scripts/migrate";
import { applyRoles, passwordFromUrl, passwordsFromEnv } from "../../scripts/roles";
import { closeDb, createDb } from "../client";
import type { TestDb } from "../test/helper";
import { createTestDb, hasTestDb, testDbUrl } from "../test/helper";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRATCH_DB = "namilux_test_m0scratch";

/**
 * Every committed migration, in journal order. Read from the journal rather than retyped, so adding
 * one does not silently drift these assertions - what they check is that a fresh database applies
 * ALL of them and then nothing.
 */
const MIGRATION_TAGS: string[] = (
  JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "migrations/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] }
).entries.map((e) => e.tag);

function scratchUrl(): string {
  const url = new URL(testDbUrl());
  url.pathname = `/${SCRATCH_DB}`;
  return url.toString();
}

async function one<T extends Record<string, unknown>>(handle: TestDb, query: ReturnType<typeof sql>): Promise<T> {
  const rows = (await handle.db.execute(query)) as unknown as T[];
  const first = rows[0];
  if (first === undefined) throw new Error("query returned no rows");
  return first;
}

describe("drizzle-kit", () => {
  it("drizzle-kit check passes on the migrations folder", () => {
    const out = execFileSync("node", ["./node_modules/drizzle-kit/bin.cjs", "check"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("Everything's fine");
  }, 120_000);

  it("drizzle-kit generate produces no diff against the committed migrations (schema == SQL)", () => {
    const out = execFileSync("node", ["./node_modules/drizzle-kit/bin.cjs", "generate"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("No schema changes");
  }, 120_000);
});

describe("scripts/roles.ts (pure)", () => {
  it("passwordFromUrl extracts the password and decodes percent-encoding", () => {
    expect(passwordFromUrl("postgres://nl_web:p%40ss:w%3Ard@127.0.0.1:5432/db")).toBe("p@ss:w:rd");
    expect(passwordFromUrl("postgres://nl_web@127.0.0.1:5432/db")).toBeNull();
    expect(() => passwordFromUrl("nonsense")).toThrow("invalid database URL");
  });

  it("passwordsFromEnv skips missing variables", () => {
    expect(
      passwordsFromEnv({
        DATABASE_URL_WEB: "postgres://nl_web:w@127.0.0.1:5432/d",
        DATABASE_URL_WORKER: "",
      }),
    ).toEqual({ web: "w" });
  });
});

describe("scripts/migrate.ts (pure)", () => {
  it("refuses APP_ENV=prod without --yes", async () => {
    const saved = process.env.APP_ENV;
    process.env.APP_ENV = "prod";
    try {
      await expect(migrateMain([])).resolves.toBe(2);
      // …and DATABASE_URL_MIGRATE alone is not enough either.
      await expect(migrateMain(["--dry-run"])).resolves.toBe(2);
    } finally {
      if (saved === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = saved;
    }
  });

  it("reports a missing DATABASE_URL_MIGRATE", async () => {
    const savedEnv = process.env.APP_ENV;
    const savedUrl = process.env.DATABASE_URL_MIGRATE;
    delete process.env.APP_ENV;
    delete process.env.DATABASE_URL_MIGRATE;
    try {
      await expect(migrateMain([])).resolves.toBe(2);
    } finally {
      if (savedEnv !== undefined) process.env.APP_ENV = savedEnv;
      if (savedUrl !== undefined) process.env.DATABASE_URL_MIGRATE = savedUrl;
    }
  });
});

describe.skipIf(!hasTestDb())("[db] migrations against DATABASE_URL_TEST", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("0000_extensions.sql", () => {
    it("[db] pg_trgm and pgcrypto are installed", async () => {
      const row = await one<{ n: number }>(
        handle,
        sql`select count(*)::int as n from pg_extension where extname in ('pg_trgm', 'pgcrypto')`,
      );
      expect(row.n).toBe(2);
    });

    it("[db] nl_fa_norm folds ي→ی and ك→ک", async () => {
      const row = await one<{ out: string }>(handle, sql`select nl_fa_norm('كيف ياس') as out`);
      expect(row.out).toBe("کیف یاس");
    });

    it("[db] nl_fa_norm folds Persian and Arabic-Indic digits to Latin", async () => {
      const row = await one<{ out: string }>(handle, sql`select nl_fa_norm('۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩') as out`);
      expect(row.out).toBe("0123456789 0123456789");
    });

    // DECISION (M0): ZWNJ/ZWJ become a SPACE, not nothing. This function's own header requires it
    // to be byte-identical to core faNorm, whose spec header gives faNorm("ویژگی‌ها") -> "ویژگی ها"
    // (@lift from v1). Deleting the joiner here while core inserted a space put the stored
    // search_text and the JS-normalized query on opposite sides of every ZWNJ word.
    // Parity re-verified over 600 real catalogue names + 9 adversarial cases: 609/609 identical.
    it("[db] nl_fa_norm strips ZWNJ, diacritics and bidi marks", async () => {
      const row = await one<{
        zwnj: string;
        diacritics: string;
        tatweel: string;
        marbuta: string;
        bidi: string;
      }>(
        handle,
        sql`select nl_fa_norm('می‌رود') as zwnj,
                   nl_fa_norm('مُحَمَّد') as diacritics,
                   nl_fa_norm('ســلام') as tatweel,
                   nl_fa_norm('ةۀ') as marbuta,
                   nl_fa_norm('a‎b­c') as bidi`,
      );
      expect(row.zwnj).toBe("می رود");
      expect(row.diacritics).toBe("محمد");
      expect(row.tatweel).toBe("سلام");
      expect(row.marbuta).toBe("هه");
      expect(row.bidi).toBe("abc");
    });

    it("[db] nl_fa_norm collapses whitespace and lowercases Latin", async () => {
      const row = await one<{ out: string; empty: string; nulled: string | null }>(
        handle,
        sql`select nl_fa_norm('  SMEG   Portofino  ') as out, nl_fa_norm('') as empty, nl_fa_norm(null) as nulled`,
      );
      expect(row.out).toBe("smeg portofino");
      expect(row.empty).toBe("");
      expect(row.nulled).toBeNull();
    });

    it("[db] nl_fa_norm is IMMUTABLE and STRICT", async () => {
      const row = await one<{ provolatile: string; proisstrict: boolean }>(
        handle,
        sql`select provolatile, proisstrict from pg_proc where proname = 'nl_fa_norm'`,
      );
      expect(row.provolatile).toBe("i");
      expect(row.proisstrict).toBe(true);
    });

    it("[db] nl_set_updated_at sets NEW.updated_at", async () => {
      await handle.db.execute(sql`delete from brands where slug = 'trigger-probe'`);
      await handle.db.execute(
        sql`insert into brands (slug, name_fa, name_en, updated_at)
            values ('trigger-probe', 'A', 'A', now() - interval '10 days')`,
      );
      const before = await one<{ updated_at: Date }>(
        handle,
        sql`select updated_at from brands where slug = 'trigger-probe'`,
      );
      await handle.db.execute(sql`update brands set name_en = 'B' where slug = 'trigger-probe'`);
      const after = await one<{ updated_at: Date }>(
        handle,
        sql`select updated_at from brands where slug = 'trigger-probe'`,
      );
      expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());

      // An update that changes nothing must not move updated_at.
      await handle.db.execute(sql`update brands set name_en = 'B' where slug = 'trigger-probe'`);
      const again = await one<{ updated_at: Date }>(
        handle,
        sql`select updated_at from brands where slug = 'trigger-probe'`,
      );
      expect(new Date(again.updated_at).getTime()).toBe(new Date(after.updated_at).getTime());
      await handle.db.execute(sql`delete from brands where slug = 'trigger-probe'`);
    });
  });

  describe("0001_init.sql manual additions", () => {
    it("[db] every mutable table has the set_updated_at trigger", async () => {
      const expected = [
        "attributes",
        "addresses",
        "banners",
        "brands",
        "carts",
        "categories",
        "collections",
        "coupons",
        "customers",
        "faqs",
        "media",
        "menus",
        "orders",
        "pages",
        "posts",
        "product_models",
        "products",
        "redirects",
        "reviews",
        "settings",
        "shipments",
        "shipping_methods",
        "staff_roles",
        "staff_users",
      ];
      const rows = (await handle.db.execute(
        sql`select c.relname as table_name
            from pg_trigger t join pg_class c on c.oid = t.tgrelid
            where t.tgname = 'set_updated_at' and not t.tgisinternal
            order by 1`,
      )) as unknown as { table_name: string }[];
      const actual = rows.map((r) => r.table_name);
      for (const table of expected) expect(actual).toContain(table);
      expect(actual).toHaveLength(expected.length);
    });

    it("[db] products.search_text and posts.search_text are generated stored columns with GIN trgm indexes", async () => {
      const generated = (await handle.db.execute(
        sql`select table_name, column_name, is_generated
            from information_schema.columns
            where table_schema = 'public'
              and ((table_name = 'products' and column_name in ('search_text', 'is_on_request'))
                or (table_name = 'posts' and column_name = 'search_text'))
            order by table_name, column_name`,
      )) as unknown as { table_name: string; column_name: string; is_generated: string }[];
      expect(generated).toHaveLength(3);
      for (const row of generated) expect(row.is_generated).toBe("ALWAYS");

      const indexes = (await handle.db.execute(
        sql`select indexname, indexdef from pg_indexes
            where schemaname = 'public'
              and indexname in ('products_search_text_trgm_idx', 'posts_search_text_trgm_idx')
            order by 1`,
      )) as unknown as { indexname: string; indexdef: string }[];
      expect(indexes).toHaveLength(2);
      for (const row of indexes) {
        expect(row.indexdef).toContain("gin");
        expect(row.indexdef).toContain("gin_trgm_ops");
      }
    });

    it("[db] events is partitioned by month after migrate", async () => {
      const parent = await one<{ relkind: string; strategy: string }>(
        handle,
        sql`select c.relkind, p.partstrat as strategy
            from pg_class c join pg_partitioned_table p on p.partrelid = c.oid
            where c.relname = 'events'`,
      );
      expect(parent.relkind).toBe("p");
      expect(parent.strategy).toBe("r");

      const parts = (await handle.db.execute(
        sql`select c.relname from pg_inherits i
            join pg_class c on c.oid = i.inhrelid
            join pg_class p on p.oid = i.inhparent
            where p.relname = 'events' order by 1`,
      )) as unknown as { relname: string }[];
      expect(parts.length).toBeGreaterThanOrEqual(3);
      for (const part of parts) expect(part.relname).toMatch(/^events_\d{6}$/);
    });

    it("[db] nl_events_ensure_partitions creates next months", async () => {
      // The test database is reused between runs, so start from a known gap.
      const target = await one<{ name: string }>(
        handle,
        sql`select to_char(date_trunc('month', now() at time zone 'UTC') + interval '6 months', '"events_"YYYYMM') as name`,
      );
      await handle.db.execute(sql.raw(`drop table if exists ${target.name}`));

      const grown = await one<{ created: number }>(handle, sql`select nl_events_ensure_partitions(6) as created`);
      expect(grown.created).toBeGreaterThan(0);
      const present = await one<{ n: number }>(
        handle,
        sql`select count(*)::int as n from pg_class where relname = ${target.name}`,
      );
      expect(present.n).toBe(1);

      const again = await one<{ created: number }>(handle, sql`select nl_events_ensure_partitions(6) as created`);
      expect(again.created).toBe(0);
      await expect(handle.db.execute(sql`select nl_events_ensure_partitions(99)`)).rejects.toThrow();
      await handle.db.execute(sql.raw(`drop table if exists ${target.name}`));
    });

    it("[db] nl_events_drop_old_partitions keeps 13 months", async () => {
      await handle.db.execute(
        sql`create table if not exists events_201501 partition of events
            for values from ('2015-01-01 00:00:00+00') to ('2015-02-01 00:00:00+00')`,
      );
      const dropped = await one<{ dropped: number }>(
        handle,
        sql`select nl_events_drop_old_partitions(13) as dropped`,
      );
      expect(dropped.dropped).toBeGreaterThanOrEqual(1);
      const remaining = await one<{ n: number }>(
        handle,
        sql`select count(*)::int as n from pg_class where relname = 'events_201501'`,
      );
      expect(remaining.n).toBe(0);

      const current = await one<{ n: number }>(
        handle,
        sql`select count(*)::int as n from pg_inherits i
            join pg_class p on p.oid = i.inhparent where p.relname = 'events'`,
      );
      expect(current.n).toBeGreaterThanOrEqual(3);
      await expect(handle.db.execute(sql`select nl_events_drop_old_partitions(0)`)).rejects.toThrow();
    });

    it("[db] nl_apply_inventory_movement is SECURITY DEFINER and owned by nl_migrate", async () => {
      const row = await one<{ prosecdef: boolean; owner: string }>(
        handle,
        sql`select prosecdef, pg_get_userbyid(proowner) as owner
            from pg_proc where proname = 'nl_apply_inventory_movement'`,
      );
      expect(row.prosecdef).toBe(true);
      expect(row.owner).toBe("nl_migrate");
    });

    it("[db] nl_apply_loyalty_delta is SECURITY DEFINER and owned by nl_migrate", async () => {
      const row = await one<{ prosecdef: boolean; owner: string }>(
        handle,
        sql`select prosecdef, pg_get_userbyid(proowner) as owner
            from pg_proc where proname = 'nl_apply_loyalty_delta'`,
      );
      expect(row.prosecdef).toBe(true);
      expect(row.owner).toBe("nl_migrate");
    });
  });

  describe("[db] scripts/migrate.ts and scripts/roles.ts on a scratch database", () => {
    let target: string;

    beforeAll(async () => {
      target = scratchUrl();
      await handle.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
      await handle.db.execute(sql.raw(`CREATE DATABASE ${SCRATCH_DB}`));
    }, 60_000);

    afterAll(async () => {
      await handle.db.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`));
    }, 60_000);

    it("dry-run lists pending migrations without applying", async () => {
      const result = await runMigrations({ url: target, dryRun: true, log: () => undefined });
      expect(result.applied).toEqual([]);
      expect(result.pending).toEqual(MIGRATION_TAGS);
      expect(result.partitionsCreated).toBe(0);
    });

    it("applyRoles fails clearly when tables do not exist yet (run migrate first)", async () => {
      await expect(
        applyRoles({ url: target, passwords: {}, log: () => undefined }),
      ).rejects.toThrow("run pnpm db:migrate first");
    });

    it("runMigrations applies pending migrations and reports their names", async () => {
      const lines: string[] = [];
      const result = await runMigrations({ url: target, log: (l) => lines.push(l) });
      expect(result.applied).toEqual(MIGRATION_TAGS);
      expect(result.pending).toEqual([]);
      expect(lines).toContain("applied 0001_init");
    }, 120_000);

    it("runMigrations is idempotent (second run applies nothing)", async () => {
      const result = await runMigrations({ url: target, log: () => undefined });
      expect(result.applied).toEqual([]);
      const still = await runMigrations({ url: target, dryRun: true, log: () => undefined });
      expect(still.pending).toEqual([]);
    });

    it("ensures event partitions after migrating", async () => {
      const db = createDb("migrate", { url: target });
      try {
        const rows = (await db.execute(
          sql`select count(*)::int as n from pg_inherits i
              join pg_class p on p.oid = i.inhparent where p.relname = 'events'`,
        )) as unknown as { n: number }[];
        expect(rows[0]?.n).toBeGreaterThanOrEqual(3);
      } finally {
        await closeDb(db);
      }
    });

    it("applyRoles creates missing roles and sets passwords from URLs", async () => {
      const passwords = passwordsFromEnv();
      const result = await applyRoles({ url: target, passwords, log: () => undefined });
      expect(result.passwordsSet.sort()).toEqual(Object.keys(passwords).sort());
      const rows = (await handle.db.execute(
        sql`select rolname from pg_roles where rolname in ('nl_web', 'nl_admin', 'nl_worker') order by 1`,
      )) as unknown as { rolname: string }[];
      expect(rows.map((r) => r.rolname)).toEqual(["nl_admin", "nl_web", "nl_worker"]);
    }, 60_000);

    it("applyRoles is idempotent (re-run leaves grants identical)", async () => {
      const grants = async (): Promise<string[]> => {
        const db = createDb("migrate", { url: target });
        try {
          const rows = (await db.execute(
            sql`select grantee || ':' || table_name || ':' || privilege_type as g
                from information_schema.role_table_grants
                where grantee in ('nl_web', 'nl_admin', 'nl_worker') order by 1`,
          )) as unknown as { g: string }[];
          return rows.map((r) => r.g);
        } finally {
          await closeDb(db);
        }
      };
      const before = await grants();
      expect(before.length).toBeGreaterThan(50);
      await applyRoles({ url: target, passwords: passwordsFromEnv(), log: () => undefined });
      const after = await grants();
      expect(after).toEqual(before);
    }, 60_000);
  });
});

