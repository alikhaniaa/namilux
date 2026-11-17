// DECISION: subpath imports (same package, narrower surface) instead of the "@namilux/core" barrel - 
// the barrel evaluates DEFAULT_SETTINGS at module load, so importing it would couple the seed spine
// to every unrelated core module being finished first. `type Actor` is type-only either way.
import { audit } from "@namilux/core/audit";
import type { Actor } from "@namilux/core/types";
import { auditLog, count, customers, desc, eq, orders, payments, sql, type Db } from "@namilux/db";
import type { Logger } from "pino";

export const SEED_ACTOR: Actor = { type: "system", id: null };

export class SeedAbort extends Error {
  // DECISION: an explicit field instead of the contract's `public code` parameter property - the repo
  // eslint config bans non-erasable TS syntax (Node type-stripping). The public shape is identical.
  code: "LIVE_DATA" | "MISSING_TABLE" | "EXTRACT_MISSING";

  constructor(message: string, code: "LIVE_DATA" | "MISSING_TABLE" | "EXTRACT_MISSING") {
    super(message);
    this.name = "SeedAbort";
    this.code = code;
  }
}

/** Natural conflict keys per table (data - see header). */
export const NATURAL_KEYS: Record<string, string> = {
  brands: "slug",
  categories: "id",
  products: "id",
  product_models: "key",
  collections: "slug",
  collection_products: "(collection_id, product_id)",
  product_categories: "(product_id, category_id)",
  product_specs: "delete-then-insert per product",
  product_images: "delete-then-insert per product",
  product_attribute_values: "(product_id, attribute_id)",
  attributes: "key",
  media: "storage_key",
  posts: "id",
  pages: "id",
  menus: "key",
  redirects: "from_path",
  seo_snapshots: "(path, crawled_at)",
  settings: "key",
  shipping_methods: "key",
  staff_roles: "name",
  inventory_movements: "append-only (reason='seed', once per product)",
  price_history: "append-only (note='seed', once per product)",
};

/** Tables the seed touches; `assertTablesExist` checks all of them before the first write. */
export const SEED_TABLES: readonly string[] = Object.keys(NATURAL_KEYS);

/** The four populations that prove a database has been used by staff or customers (see contract). */
type LiveCount = { table: "orders" | "customers" | "audit_log(staff)" | "payments"; rows: number };

async function firstCount(q: PromiseLike<{ n: number }[]>): Promise<number> {
  const rows = await q;
  return rows[0]?.n ?? 0;
}

export async function guardAgainstLiveData(db: Db, i: { force: boolean; log: Logger }): Promise<void> {
  // Order mirrors the contract. All four are counted even when the first is non-zero so that
  // `--force` can log every population it is about to seed over.
  const counts: LiveCount[] = [
    { table: "orders", rows: await firstCount(db.select({ n: count() }).from(orders)) },
    { table: "customers", rows: await firstCount(db.select({ n: count() }).from(customers)) },
    {
      table: "audit_log(staff)",
      rows: await firstCount(db.select({ n: count() }).from(auditLog).where(eq(auditLog.actorType, "staff"))),
    },
    { table: "payments", rows: await firstCount(db.select({ n: count() }).from(payments)) },
  ];
  const live = counts.filter((c) => c.rows > 0);
  if (live.length === 0) return;

  if (!i.force) {
    const detail = live.map((c) => `${c.table}=${c.rows}`).join(", ");
    throw new SeedAbort(
      `refusing to seed a database that already carries live data: ${detail}. ` +
        "Re-seeding overwrites catalogue and content rows by natural key, which is only safe on a " +
        "database no customer or staff member has used; after launch corrections belong in the admin. " +
        "Use --force only if you are certain.",
      "LIVE_DATA",
    );
  }
  for (const c of live) {
    i.log.warn({ table: c.table, rows: c.rows }, "seed --force: live data present, seeding over it anyway");
  }
}

export async function assertTablesExist(db: Db, tables: readonly string[]): Promise<void> {
  // DECISION: read the whole public table list and diff in memory instead of parameterising an
  // `IN (…)` - no caller value ever reaches the SQL string (the spec "string-built SQL"), and there is
  // no parameter-type inference to get wrong on information_schema's `sql_identifier` domain.
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const present = new Set<string>();
  for (const row of rows) present.add(row.table_name);
  const missing = tables.filter((t) => !present.has(t));
  if (missing.length > 0) {
    throw new SeedAbort(`missing tables (run pnpm db:migrate first): ${missing.join(", ")}`, "MISSING_TABLE");
  }
}

/** Sequential by contract: a seed batch never fans out writes, and a failing chunk aborts the stage. */
export async function inChunks<T>(rows: readonly T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  // DECISION: a non-integer or non-positive size falls back to the documented default of 200 instead
  // of throwing - the alternatives are an infinite loop (size 0) or a silent no-op.
  const step = Number.isInteger(size) && size > 0 ? size : 200;
  for (let start = 0; start < rows.length; start += step) {
    await fn(rows.slice(start, start + step));
  }
}

export async function stampRun(db: Db, i: { runId: string; summary: object }): Promise<void> {
  await audit.log(db, SEED_ACTOR, "seed.run", "seed", i.runId, undefined, i.summary);
}

export async function previousRuns(db: Db): Promise<{ runId: string; at: string }[]> {
  const rows = await db
    .select({ runId: auditLog.entityId, at: auditLog.createdAt })
    .from(auditLog)
    .where(eq(auditLog.action, "seed.run"))
    .orderBy(desc(auditLog.createdAt));
  return rows.map((r) => ({ runId: r.runId, at: r.at.toISOString() }));
}
