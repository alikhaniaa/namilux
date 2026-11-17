import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import pg from "postgres";
import type postgres from "postgres";
import * as relationsModule from "./relations";
import * as tables from "./schema";

export type DbRole = "web" | "admin" | "worker" | "migrate";

export const DB_ROLES: readonly DbRole[] = ["web", "admin", "worker", "migrate"] as const;

export type RoleLimits = {
  pgRole: string;
  envVar: string;
  poolMax: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTxTimeoutMs: number;
  connectTimeoutSec: number;
};

export const ROLE_LIMITS: Record<DbRole, RoleLimits> = {
  web: {
    pgRole: "nl_web",
    envVar: "DATABASE_URL_WEB",
    poolMax: 10,
    statementTimeoutMs: 5_000,
    lockTimeoutMs: 3_000,
    idleInTxTimeoutMs: 10_000,
    connectTimeoutSec: 10,
  },
  admin: {
    pgRole: "nl_admin",
    envVar: "DATABASE_URL_ADMIN",
    poolMax: 5,
    statementTimeoutMs: 30_000,
    lockTimeoutMs: 5_000,
    idleInTxTimeoutMs: 30_000,
    connectTimeoutSec: 10,
  },
  worker: {
    pgRole: "nl_worker",
    envVar: "DATABASE_URL_WORKER",
    poolMax: 5,
    statementTimeoutMs: 300_000,
    lockTimeoutMs: 10_000,
    idleInTxTimeoutMs: 300_000,
    connectTimeoutSec: 10,
  },
  migrate: {
    pgRole: "nl_migrate",
    envVar: "DATABASE_URL_MIGRATE",
    poolMax: 1,
    statementTimeoutMs: 0,
    lockTimeoutMs: 0,
    idleInTxTimeoutMs: 0,
    connectTimeoutSec: 10,
  },
};

export const schema = { ...tables, ...relationsModule };
export type Schema = typeof schema;

export type Db = PgDatabase<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbTx = PgTransaction<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type DbClient = PostgresJsDatabase<Schema> & { $client: postgres.Sql };

export type CreateDbOptions = {
  url?: string;
  poolMax?: number;
  applicationName?: string;
  onNotice?: (notice: postgres.Notice) => void;
};

/** Hosts that count as "this machine or the dev compose network" (see assertLocalDatabase). */
const LOCAL_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "::1", "db", "postgres"];

const noop = (): void => {
  /* notices are dropped unless the caller asks for them */
};

function isDbRole(role: string): role is DbRole {
  return (DB_ROLES as readonly string[]).includes(role);
}

export function createDb(role: DbRole, opts?: CreateDbOptions): DbClient {
  if (!isDbRole(role)) throw new Error("unknown db role");
  const limits = ROLE_LIMITS[role];
  const url = opts?.url ?? process.env[limits.envVar] ?? "";
  if (url === "") throw new Error(`${limits.envVar} is not set`);

  // DECISION: the timeouts travel as startup GUCs (strings of milliseconds) on every pooled
  // connection, so they hold even if the role-level `ALTER ROLE … SET` of roles.sql is missing
  // (fresh database, or a superuser DSN in dev). 0 = disabled, which is what nl_migrate wants.
  // They MUST be strings: postgres.js builds the startup packet with `.filter(([, v]) => v)`, so a
  // numeric 0 would be dropped silently. Its .d.ts types these three GUCs as `number`; hence the
  // single cast below.
  const connection = {
    application_name: opts?.applicationName ?? limits.pgRole,
    search_path: "public",
    statement_timeout: String(limits.statementTimeoutMs),
    lock_timeout: String(limits.lockTimeoutMs),
    idle_in_transaction_session_timeout: String(limits.idleInTxTimeoutMs),
  } as unknown as Partial<postgres.ConnectionParameters>;

  const client = pg(url, {
    max: opts?.poolMax ?? limits.poolMax,
    connect_timeout: limits.connectTimeoutSec,
    idle_timeout: 30,
    max_lifetime: 60 * 30,
    prepare: true,
    onnotice: opts?.onNotice ?? noop,
    connection,
  });

  return drizzle(client, { schema, logger: false });
}

export function getDb(role: DbRole, opts?: CreateDbOptions): DbClient {
  if (!isDbRole(role)) throw new Error("unknown db role");
  // Stored on globalThis so Next.js dev HMR (which re-evaluates modules) reuses one pool per role.
  const key = Symbol.for(`namilux.db.${role}`);
  const holder = globalThis as unknown as Record<symbol, DbClient | undefined>;
  const existing = holder[key];
  if (existing !== undefined) return existing;
  const created = createDb(role, opts);
  holder[key] = created;
  return created;
}

/** Pools already asked to close - `closeDb` must be safe to call twice (spec edge cases). */
const closed = new WeakSet<object>();

export async function closeDb(db: DbClient): Promise<void> {
  const client = db.$client;
  if (closed.has(client)) return;
  closed.add(client);
  await client.end({ timeout: 5 });
}

export async function pingDb(db: Db): Promise<{ ok: true; role: string; ms: number }> {
  const started = Date.now();
  const rows = (await db.execute(sql`select current_user as role`)) as unknown as { role: string }[];
  const first = rows[0];
  return { ok: true, role: first?.role ?? "", ms: Date.now() - started };
}

export function assertLocalDatabase(url: string): void {
  let host: string;
  try {
    // `new URL` accepts any scheme; postgres:// URLs expose the host on `hostname`.
    const parsed = new URL(url);
    host = parsed.hostname;
  } catch {
    // DECISION: an unparsable DSN is treated as remote - a guard must never pass by accident.
    throw new Error("refusing to run against a non-local database: <unparsable url>");
  }
  // IPv6 hosts arrive bracketed ("[::1]").
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (!LOCAL_HOSTS.includes(bare)) {
    throw new Error(`refusing to run against a non-local database: ${bare === "" ? "<empty host>" : bare}`);
  }
}

export function redactDbUrl(url: string): string {
  // Pure string surgery on the userinfo section: never parse/re-serialise (that would rewrite
  // percent-encoding) and never throw - this function only ever feeds a log line.
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^@/?#]*)@/, (_m, scheme: string, userinfo: string) => {
    const colon = userinfo.indexOf(":");
    if (colon === -1) return `${scheme}${userinfo}@`;
    return `${scheme}${userinfo.slice(0, colon)}:***@`;
  });
}
