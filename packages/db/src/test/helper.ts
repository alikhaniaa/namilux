import { and, eq, sql } from "drizzle-orm";
import { runMigrations } from "../../scripts/migrate";
import { applyRoles, passwordsFromEnv } from "../../scripts/roles";
import type { Db, DbClient, DbRole, DbTx } from "../client";
import { ROLE_LIMITS, assertLocalDatabase, closeDb, createDb } from "../client";
import { brands, categories, customers, inventoryMovements, productCategories, products } from "../schema";

export type TestDb = {
  db: DbClient;
  url: string;
  role: DbRole;
  close(): Promise<void>;
};

export const TEST_PHONE = "09121234567";
export const TEST_PRODUCT_SLUG = "test-product";

/** Fixed ULID-shaped ids so seedMinimal is idempotent without a generator. */
const TEST_CUSTOMER_ID = "0000000000000000000TEST001";
const TEST_BRAND_SLUG = "smeg";
const TEST_CATEGORY_SLUG = "test-category";
const TEST_PRODUCT_PRICE = 41_500_000;
const TEST_PRODUCT_STOCK = 3;

export function hasTestDb(): boolean {
  const url = process.env.DATABASE_URL_TEST;
  return typeof url === "string" && url !== "";
}

export function testDbUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (url === undefined || url === "") throw new Error("DATABASE_URL_TEST is not set");
  return url;
}

export function testUrlForRole(role: Exclude<DbRole, "migrate">, testUrl?: string): string {
  const envVar = ROLE_LIMITS[role].envVar;
  const roleUrl = process.env[envVar];
  if (roleUrl === undefined || roleUrl === "") throw new Error(`${envVar} is not set`);
  const target = new URL(testUrl ?? testDbUrl());
  const source = new URL(roleUrl);
  // Credentials of the role, everything else (host, port, database, params) of the TEST url.
  target.username = source.username;
  target.password = source.password;
  return target.toString();
}

/** TRUNCATE and friends must never touch a shared database - every entry point re-checks. */
function assertLocalClient(db: DbClient): void {
  const options = db.$client.options as unknown as { host?: unknown };
  const hosts = Array.isArray(options.host) ? options.host : [options.host];
  const host = typeof hosts[0] === "string" ? hosts[0] : "";
  assertLocalDatabase(`postgres://${host.startsWith("::") ? `[${host}]` : host}/`);
}

function assertNotDevDatabase(url: string): void {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error("DATABASE_URL_TEST is not a valid URL");
  }
  if (name === "namilux") throw new Error("DATABASE_URL_TEST must not target the dev database");
}

const MIGRATED = Symbol.for("namilux.test.migrated");

/** Migrations + grants run once per process, however many test files ask for a database. */
function prepareOnce(url: string): Promise<void> {
  const holder = globalThis as unknown as Record<symbol, Promise<void> | undefined>;
  const existing = holder[MIGRATED];
  if (existing !== undefined) return existing;
  const started = (async () => {
    await runMigrations({ url, log: () => undefined });
    await applyRoles({ url, passwords: passwordsFromEnv(), log: () => undefined });
  })();
  holder[MIGRATED] = started;
  return started;
}

export async function createTestDb(opts?: { migrate?: boolean }): Promise<TestDb> {
  const url = testDbUrl();
  assertLocalDatabase(url);
  assertNotDevDatabase(url);
  if (opts?.migrate !== false) await prepareOnce(url);
  const db = createDb("migrate", { url, poolMax: 4, applicationName: "nl_test" });
  return { db, url, role: "migrate", close: () => closeDb(db) };
}

export async function createTestDbAs(role: Exclude<DbRole, "migrate">): Promise<TestDb> {
  const url = testUrlForRole(role);
  assertLocalDatabase(url);
  assertNotDevDatabase(url);
  const db = createDb(role, { url, poolMax: 2, applicationName: `nl_test_${role}` });
  try {
    await db.execute(sql`select 1`);
  } catch (err: unknown) {
    await closeDb(db);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`cannot connect as ${ROLE_LIMITS[role].pgRole}: ${message} — run pnpm db:roles`, {
      cause: err,
    });
  }
  return { db, url, role, close: () => closeDb(db) };
}

export async function truncateAll(db: DbClient): Promise<void> {
  assertLocalClient(db);
  const rows = (await db.execute(
    sql`select quote_ident(schemaname) || '.' || quote_ident(tablename) as ident from pg_tables where schemaname = 'public'`,
  )) as unknown as { ident: string }[];
  if (rows.length === 0) return;
  // Identifiers come from pg_tables, already quoted by quote_ident: no user input reaches this
  // string, and TRUNCATE cannot be parameterised.
  const list = rows.map((r) => r.ident).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`));
  await db.execute(sql`select nl_events_ensure_partitions(2)`);
}

/** Thrown to force a rollback; never escapes withTestTx. */
class RollbackSignal extends Error {
  constructor() {
    super("withTestTx: rollback");
    this.name = "RollbackSignal";
  }
}

export async function withTestTx<T>(db: DbClient, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  const captured: T[] = [];
  try {
    await db.transaction(async (tx) => {
      captured.push(await fn(tx));
      throw new RollbackSignal();
    });
  } catch (err: unknown) {
    if (!(err instanceof RollbackSignal)) throw err;
  }
  if (captured.length === 0) throw new Error("withTestTx: the transaction body never completed");
  const [value] = captured as [T];
  return value;
}

export async function seedMinimal(
  db: Db,
): Promise<{ brandId: number; categoryId: number; productId: number; customerId: string }> {
  const [brand] = await db
    .insert(brands)
    .values({ slug: TEST_BRAND_SLUG, nameFa: "Smeg", nameEn: "Smeg" })
    .onConflictDoUpdate({ target: brands.slug, set: { nameEn: "Smeg" } })
    .returning({ id: brands.id });
  if (brand === undefined) throw new Error("seedMinimal: brand upsert returned nothing");

  const [category] = await db
    .insert(categories)
    .values({ slug: TEST_CATEGORY_SLUG, path: TEST_CATEGORY_SLUG, name: "Test category" })
    .onConflictDoUpdate({ target: categories.path, set: { name: "Test category" } })
    .returning({ id: categories.id });
  if (category === undefined) throw new Error("seedMinimal: category upsert returned nothing");

  const [product] = await db
    .insert(products)
    .values({
      slug: TEST_PRODUCT_SLUG,
      name: "Test product",
      displayName: "Test product",
      brandId: brand.id,
      status: "active",
      visibility: "public",
      price: TEST_PRODUCT_PRICE,
    })
    .onConflictDoUpdate({
      target: products.slug,
      set: { price: TEST_PRODUCT_PRICE, status: "active", visibility: "public", brandId: brand.id },
    })
    .returning({ id: products.id });
  if (product === undefined) throw new Error("seedMinimal: product upsert returned nothing");

  await db
    .insert(productCategories)
    .values({ productId: product.id, categoryId: category.id, isPrimary: true })
    .onConflictDoNothing();

  // Stock is only ever set through the ledger (inv. 5); insert the seed movement once.
  const seeded = await db
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.productId, product.id), eq(inventoryMovements.reason, "seed")))
    .limit(1);
  if (seeded.length === 0) {
    await db.insert(inventoryMovements).values({
      productId: product.id,
      delta: TEST_PRODUCT_STOCK,
      reason: "seed",
      actorType: "system",
    });
  }

  const [customer] = await db
    .insert(customers)
    .values({ id: TEST_CUSTOMER_ID, phone: TEST_PHONE, referralCode: "TEST0001" })
    .onConflictDoUpdate({ target: customers.phone, set: { referralCode: "TEST0001" } })
    .returning({ id: customers.id });
  if (customer === undefined) throw new Error("seedMinimal: customer upsert returned nothing");

  return {
    brandId: brand.id,
    categoryId: category.id,
    productId: product.id,
    customerId: customer.id,
  };
}
