import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient, SQL } from "../index";
import { eq, products, productWebColumns, sql } from "../index";
import type { TestDb } from "../test/helper";
import { createTestDb, createTestDbAs, hasTestDb, seedMinimal, truncateAll } from "../test/helper";

const DB = hasTestDb();

const APP_ROLES = ["nl_web", "nl_admin", "nl_worker"] as const;

let owner: TestDb | undefined;
let webHandle: TestDb | undefined;
let adminHandle: TestDb | undefined;
let workerHandle: TestDb | undefined;

function open(handle: TestDb | undefined): DbClient {
  if (handle === undefined) throw new Error("test database handle is not open");
  return handle.db;
}

const db = (): DbClient => open(owner);
const web = (): DbClient => open(webHandle);
const admin = (): DbClient => open(adminHandle);
const worker = (): DbClient => open(workerHandle);

const byRole = (): Record<(typeof APP_ROLES)[number], DbClient> => ({
  nl_web: web(),
  nl_admin: admin(),
  nl_worker: worker(),
});

beforeAll(async () => {
  if (!DB) return;
  owner = await createTestDb();
  webHandle = await createTestDbAs("web");
  adminHandle = await createTestDbAs("admin");
  workerHandle = await createTestDbAs("worker");
});

afterAll(async () => {
  // Role clients first: truncateAll (owner) needs ACCESS EXCLUSIVE locks (helper.ts edge cases).
  await webHandle?.close();
  await adminHandle?.close();
  await workerHandle?.close();
  await owner?.close();
});

beforeEach(async () => {
  if (owner !== undefined) await truncateAll(owner.db);
});

async function rows<T extends Record<string, unknown>>(query: SQL, client: DbClient = db()): Promise<T[]> {
  return (await client.execute(query)) as unknown as T[];
}

/** Drizzle wraps driver errors; walk the `cause` chain for the Postgres SQLSTATE. */
function sqlState(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current) {
      const code: unknown = current.code;
      if (typeof code === "string") return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** The statement must be rejected with insufficient_privilege - never silently succeed. */
async function denied(client: DbClient, query: SQL): Promise<void> {
  let got: string | null = null;
  try {
    await client.execute(query);
  } catch (err: unknown) {
    got = sqlState(err);
  }
  expect(got).toBe("42501");
}

/** The statement must run (0 rows is fine - privileges are checked before rows are touched). */
async function allowed(client: DbClient, query: SQL): Promise<void> {
  await client.execute(query);
}

async function tablePriv(role: string, table: string, priv: string): Promise<boolean> {
  const found = await rows<{ ok: boolean }>(
    sql`select has_table_privilege(${role}::name, ${table}::text, ${priv}::text) as ok`,
  );
  return found[0]?.ok === true;
}

async function columnPriv(role: string, table: string, column: string, priv: string): Promise<boolean> {
  const found = await rows<{ ok: boolean }>(
    sql`select has_column_privilege(${role}::name, ${table}::text, ${column}::text, ${priv}::text) as ok`,
  );
  return found[0]?.ok === true;
}

/** Table-level grants exactly as information_schema reports them (column grants are not listed). */
async function tableGrants(role: string, table: string): Promise<string[]> {
  const found = await rows<{ privilege_type: string }>(
    sql`select distinct privilege_type from information_schema.role_table_grants
        where grantee = ${role} and table_schema = 'public' and table_name = ${table}
        order by 1`,
  );
  return found.map((r) => r.privilege_type);
}

async function seed(): Promise<{ productId: number; customerId: string }> {
  const { productId, customerId } = await seedMinimal(db());
  return { productId, customerId };
}

// ═══ existence and settings ═════════════════════════════════════════════════════════════════════

describe("roles: existence and settings", () => {
  it.skipIf(!DB)("nl_web, nl_admin, nl_worker, nl_migrate exist with LOGIN and NOSUPERUSER", async () => {
    const found = await rows<{
      rolname: string;
      rolsuper: boolean;
      rolcanlogin: boolean;
      rolcreatedb: boolean;
      rolconnlimit: number;
    }>(
      sql`select rolname, rolsuper, rolcanlogin, rolcreatedb, rolconnlimit
          from pg_roles
          where rolname in ('nl_web', 'nl_admin', 'nl_worker', 'nl_migrate')
          order by rolname`,
    );
    expect(found.map((r) => r.rolname)).toEqual(["nl_admin", "nl_migrate", "nl_web", "nl_worker"]);
    for (const role of found) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolcanlogin).toBe(true);
      // NOCREATEDB is part of the roles.sql contract for the three app roles only; nl_migrate is
      // created by the DBA/compose (README.md §2) and may create databases.
      if (role.rolname !== "nl_migrate") expect(role.rolcreatedb).toBe(false);
    }
    // CONNECTION LIMIT nl_web 40 · nl_admin 15 · nl_worker 15 (roles.sql contract).
    const limits = Object.fromEntries(found.map((r) => [r.rolname, r.rolconnlimit]));
    expect(limits["nl_web"]).toBe(40);
    expect(limits["nl_admin"]).toBe(15);
    expect(limits["nl_worker"]).toBe(15);
  });

  it.skipIf(!DB)("role-level statement_timeout matches ROLE_LIMITS (5s / 30s / 5min / off)", async () => {
    const found = await rows<{ rolname: string; cfg: string[] | null }>(
      sql`select rolname, rolconfig as cfg from pg_roles
          where rolname in ('nl_web', 'nl_admin', 'nl_worker', 'nl_migrate')`,
    );
    const config = new Map(found.map((r) => [r.rolname, r.cfg ?? []]));
    expect(config.get("nl_web")).toContain("statement_timeout=5s");
    expect(config.get("nl_admin")).toContain("statement_timeout=30s");
    expect(config.get("nl_worker")).toContain("statement_timeout=5min");
    // nl_migrate has no role-level timeout at all - long migrations must not be killed.
    expect((config.get("nl_migrate") ?? []).some((c) => c.startsWith("statement_timeout"))).toBe(false);

    expect(config.get("nl_web")).toContain("lock_timeout=3s");
    expect(config.get("nl_admin")).toContain("lock_timeout=5s");
    expect(config.get("nl_worker")).toContain("lock_timeout=10s");
    expect(config.get("nl_web")).toContain("idle_in_transaction_session_timeout=10s");
    expect(config.get("nl_admin")).toContain("idle_in_transaction_session_timeout=30s");
    expect(config.get("nl_worker")).toContain("idle_in_transaction_session_timeout=5min");
  });

  it.skipIf(!DB)("search_path is pinned to public for every app role", async () => {
    const found = await rows<{ rolname: string; cfg: string[] | null }>(
      sql`select rolname, rolconfig as cfg from pg_roles where rolname in ('nl_web', 'nl_admin', 'nl_worker')`,
    );
    expect(found).toHaveLength(3);
    for (const role of found) expect(role.cfg ?? []).toContain("search_path=public");

    for (const client of Object.values(byRole())) {
      const shown = await rows<{ search_path: string }>(sql`show search_path`, client);
      expect(shown[0]?.search_path).toBe("public");
    }
  });

  it.skipIf(!DB)("app roles cannot CREATE in schema public", async () => {
    for (const role of APP_ROLES) {
      const found = await rows<{ ok: boolean }>(
        sql`select has_schema_privilege(${role}::name, 'public', 'CREATE') as ok`,
      );
      expect(found[0]?.ok).toBe(false);
      const usage = await rows<{ ok: boolean }>(
        sql`select has_schema_privilege(${role}::name, 'public', 'USAGE') as ok`,
      );
      expect(usage[0]?.ok).toBe(true);
    }
    await denied(web(), sql`create table nl_probe_web (x integer)`);
    await denied(worker(), sql`create table nl_probe_worker (x integer)`);
  });

  it.skipIf(!DB)("app roles have no access to schema drizzle", async () => {
    for (const role of APP_ROLES) {
      const found = await rows<{ ok: boolean }>(
        sql`select has_schema_privilege(${role}::name, 'drizzle', 'USAGE') as ok`,
      );
      expect(found[0]?.ok).toBe(false);
    }
    for (const client of Object.values(byRole())) {
      await denied(client, sql`select count(*) from drizzle.__drizzle_migrations`);
    }
  });

  it.skipIf(!DB)("grant matrix sample matches information_schema.role_table_grants", async () => {
    // Money and URL tables: no DELETE for anybody.
    for (const role of APP_ROLES) {
      for (const table of ["orders", "payments", "products", "customers", "posts", "brands"]) {
        expect(await tableGrants(role, table)).not.toContain("DELETE");
      }
    }
    // Staff tables are invisible to web and worker; addresses are invisible to the worker.
    expect(await tableGrants("nl_web", "staff_users")).toEqual([]);
    expect(await tableGrants("nl_worker", "staff_users")).toEqual([]);
    expect(await tableGrants("nl_worker", "addresses")).toEqual([]);
    expect(await tableGrants("nl_web", "price_history")).toEqual([]);
    expect(await tableGrants("nl_worker", "metrics_daily")).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
    // settings: read-only for web and worker, no DELETE for admin.
    expect(await tableGrants("nl_web", "settings")).toEqual(["SELECT"]);
    expect(await tableGrants("nl_worker", "settings")).toEqual(["SELECT"]);
    expect(await tableGrants("nl_admin", "settings")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    // Append-only tables: INSERT (+SELECT where allowed), never UPDATE/DELETE.
    expect(await tableGrants("nl_web", "audit_log")).toEqual(["INSERT"]);
    expect(await tableGrants("nl_admin", "audit_log")).toEqual(["INSERT", "SELECT"]);
    expect(await tableGrants("nl_web", "loyalty_ledger")).toEqual(["INSERT", "SELECT"]);
    expect(await tableGrants("nl_web", "events")).toEqual(["INSERT"]);
  });
});

// ═══ nl_web ═════════════════════════════════════════════════════════════════════════════════════

describe("roles: nl_web", () => {
  it.skipIf(!DB)("nl_web cannot select products.cost_price", async () => {
    await seed();
    await denied(web(), sql`select cost_price from products`);
    // …and therefore `select *` on products is denied too (rules: project the columns).
    await denied(web(), sql`select * from products`);
    expect(await columnPriv("nl_web", "products", "cost_price", "SELECT")).toBe(false);
    expect(await columnPriv("nl_admin", "products", "cost_price", "SELECT")).toBe(true);
  });

  it.skipIf(!DB)("nl_web can select productWebColumns", async () => {
    const { productId } = await seed();
    const found = await web().select(productWebColumns).from(products).where(eq(products.id, productId));
    expect(found[0]?.price).toBe(41_500_000);
    expect(found[0]?.searchText).toContain("test product");
    for (const column of Object.values(productWebColumns)) {
      expect(await columnPriv("nl_web", "products", column.name, "SELECT")).toBe(true);
    }
  });

  it.skipIf(!DB)("nl_web cannot update products.stock_qty", async () => {
    await seed();
    await denied(web(), sql`update products set stock_qty = 99`);
    await denied(web(), sql`update products set price = 1`);
    await denied(web(), sql`update products set rating_avg = 5`);
    expect(await columnPriv("nl_web", "products", "stock_qty", "UPDATE")).toBe(false);
  });

  it.skipIf(!DB)("nl_web can SELECT … FOR UPDATE on products (view_count grant)", async () => {
    const { productId } = await seed();
    await allowed(web(), sql`select id from products where id = ${productId} for update`);
    await allowed(web(), sql`update products set view_count = view_count + 1 where id = ${productId}`);
    const after = await rows<{ view_count: number }>(
      // ::int - a raw bigint comes back from the driver as a string (client.ts rules).
      sql`select view_count::int as view_count from products where id = ${productId}`,
    );
    expect(after[0]?.view_count).toBe(1);
  });

  it.skipIf(!DB)("nl_web can SELECT … FOR UPDATE on coupons but not change code/value", async () => {
    await db().execute(sql`insert into coupons (code, kind, value) values ('WEB10', 'percent', 10)`);
    await allowed(web(), sql`select id from coupons where code = 'WEB10' for update`);
    await allowed(web(), sql`update coupons set updated_at = now() where code = 'WEB10'`);
    await denied(web(), sql`update coupons set code = 'HACKED'`);
    await denied(web(), sql`update coupons set value = 100`);
    await denied(web(), sql`update coupons set is_active = false`);
    await denied(web(), sql`delete from coupons`);
  });

  it.skipIf(!DB)("nl_web has no access to staff_users", async () => {
    for (const table of ["staff_users", "staff_roles", "staff_sessions", "webauthn_credentials"]) {
      expect(await tableGrants("nl_web", table)).toEqual([]);
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await tablePriv("nl_web", table, priv)).toBe(false);
      }
    }
    await denied(web(), sql`select count(*) from staff_users`);
    await denied(web(), sql`select count(*) from staff_sessions`);
  });

  it.skipIf(!DB)("nl_web can only INSERT events", async () => {
    await allowed(
      web(),
      sql`insert into events (type, path, session_hash, ua_class) values ('page_view', '/', 'h', 'mobile')`,
    );
    const count = await rows<{ n: number }>(sql`select count(*)::int as n from events`);
    expect(count[0]?.n).toBe(1);
    await denied(web(), sql`select count(*) from events`);
    await denied(web(), sql`update events set type = 'x'`);
    await denied(web(), sql`delete from events`);
  });

  it.skipIf(!DB)("nl_web cannot write settings", async () => {
    await db().execute(sql`insert into settings (key, value_json) values ('commerce', '{}'::jsonb)`);
    await allowed(web(), sql`select key from settings`);
    await denied(web(), sql`insert into settings (key, value_json) values ('x', '{}'::jsonb)`);
    await denied(web(), sql`update settings set value_json = '{}'::jsonb`);
    await denied(web(), sql`delete from settings`);
  });

  it.skipIf(!DB)("nl_web can update redirects.hits only", async () => {
    await db().execute(
      sql`insert into redirects (from_path, to_path, code, source) values ('/old/', '/new/', 301, 'legacy')`,
    );
    await allowed(web(), sql`update redirects set hits = hits + 1, last_hit_at = now() where from_path = '/old/'`);
    const after = await rows<{ hits: number }>(sql`select hits from redirects where from_path = '/old/'`);
    expect(after[0]?.hits).toBe(1);
    await denied(web(), sql`update redirects set to_path = '/hacked/'`);
    await denied(web(), sql`update redirects set is_active = false`);
    await denied(web(), sql`insert into redirects (from_path, to_path, code, source) values ('/a/', '/b/', 301, 'manual')`);
    await denied(web(), sql`delete from redirects`);
  });

  it.skipIf(!DB)("nl_web can INSERT audit_log but not SELECT it", async () => {
    await allowed(
      web(),
      sql`insert into audit_log (actor_type, action, entity, entity_id)
          values ('customer', 'order.place', 'orders', '1')`,
    );
    const count = await rows<{ n: number }>(sql`select count(*)::int as n from audit_log`);
    expect(count[0]?.n).toBe(1);
    await denied(web(), sql`select count(*) from audit_log`);
  });

  it.skipIf(!DB)("nl_web can INSERT inventory_movements and stock_qty updates via trigger", async () => {
    const { productId } = await seed();
    await allowed(
      web(),
      sql`insert into inventory_movements (product_id, delta, reason, actor_type)
          values (${productId}, -2, 'sale', 'customer')`,
    );
    const after = await rows<{ stock_qty: number }>(
      sql`select stock_qty from products where id = ${productId}`,
    );
    expect(after[0]?.stock_qty).toBe(1);
    await denied(web(), sql`update inventory_movements set delta = 1`);
    await denied(web(), sql`delete from inventory_movements`);
  });

  it.skipIf(!DB)("nl_web can INSERT loyalty_ledger and points_balance updates via trigger", async () => {
    const { customerId } = await seed();
    await allowed(
      web(),
      sql`insert into loyalty_ledger (customer_id, delta, reason) values (${customerId}, 120, 'earn')`,
    );
    const after = await rows<{ points_balance: number }>(
      sql`select points_balance from customers where id = ${customerId}`,
    );
    expect(after[0]?.points_balance).toBe(120);
    expect(await columnPriv("nl_web", "customers", "points_balance", "UPDATE")).toBe(true);
    await denied(web(), sql`update loyalty_ledger set delta = 1`);
    await denied(web(), sql`delete from loyalty_ledger`);
  });

  it.skipIf(!DB)("nl_web cannot update payments.amount", async () => {
    await denied(web(), sql`update payments set amount = 1`);
    await denied(web(), sql`update payments set order_id = 'x'`);
    await denied(web(), sql`update payments set driver = 'x'`);
    expect(await columnPriv("nl_web", "payments", "amount", "UPDATE")).toBe(false);
  });

  it.skipIf(!DB)("nl_web can update payments.status", async () => {
    await allowed(web(), sql`update payments set status = 'succeeded', verified_at = now(), ref_id = 'r'`);
    for (const column of ["status", "authority", "ref_id", "card_pan_masked", "fee", "raw_json", "verified_at"]) {
      expect(await columnPriv("nl_web", "payments", column, "UPDATE")).toBe(true);
    }
  });

  it.skipIf(!DB)("nl_web can delete cart_items, wishlists, addresses", async () => {
    for (const table of ["cart_items", "wishlists", "addresses", "carts", "rate_limits"]) {
      expect(await tablePriv("nl_web", table, "DELETE")).toBe(true);
    }
    await allowed(web(), sql`delete from cart_items`);
    await allowed(web(), sql`delete from wishlists`);
    await allowed(web(), sql`delete from addresses`);
  });
});

// ═══ nl_admin ═══════════════════════════════════════════════════════════════════════════════════

describe("roles: nl_admin", () => {
  it.skipIf(!DB)("nl_admin cannot update products.stock_qty directly", async () => {
    await seed();
    await denied(admin(), sql`update products set stock_qty = 99`);
    expect(await columnPriv("nl_admin", "products", "stock_qty", "UPDATE")).toBe(false);
    // …but every other editable column is admin's to change.
    await allowed(admin(), sql`update products set price = 1000, cost_price = 500`);
  });

  it.skipIf(!DB)("nl_admin can select products.cost_price", async () => {
    await seed();
    await allowed(admin(), sql`select cost_price from products`);
    await allowed(admin(), sql`select * from products`);
  });

  it.skipIf(!DB)("nl_admin has full DML on staff_* tables", async () => {
    const inserted = await rows<{ id: number }>(
      sql`insert into staff_roles (name, permissions) values ('t-role', '[]'::jsonb) returning id`,
      admin(),
    );
    const roleId = inserted[0]?.id;
    expect(roleId).toBeGreaterThan(0);
    await allowed(
      admin(),
      sql`insert into staff_users (id, email, name, password_hash, role_id)
          values ('0000000000000000000GRNT01', 'a@namilux.ir', 'A', 'hash', ${roleId})`,
    );
    await allowed(admin(), sql`update staff_users set is_active = false where email = 'a@namilux.ir'`);
    await allowed(admin(), sql`select count(*) from staff_users`);
    await allowed(admin(), sql`delete from staff_sessions`);
    await allowed(admin(), sql`delete from webauthn_credentials`);
    // The head admin (owner) may remove a staff member outright - the owner/admin split, 0004.
    await allowed(admin(), sql`delete from staff_users where email = 'a@namilux.ir'`);
    // A role row is still never hard-deleted: staff_users.role_id points at it.
    await denied(admin(), sql`delete from staff_roles`);
  });

  it.skipIf(!DB)("nl_admin cannot DDL (create table) in public", async () => {
    await denied(admin(), sql`create table nl_probe_admin (x integer)`);
    await denied(admin(), sql`create index nl_probe_idx on products (slug)`);
  });

  it.skipIf(!DB)("nl_admin can SELECT audit_log and security_events", async () => {
    await allowed(admin(), sql`select count(*) from audit_log`);
    await allowed(admin(), sql`select count(*) from security_events`);
    await allowed(admin(), sql`insert into security_events (kind) values ('staff.login.failed')`);
    await denied(admin(), sql`update audit_log set action = 'x'`);
    await denied(admin(), sql`delete from audit_log`);
  });

  it.skipIf(!DB)("nl_admin can delete order_items, media, banners, faqs, shipping_methods, product child rows", async () => {
    for (const table of [
      "order_items",
      "media",
      "banners",
      "faqs",
      "shipping_methods",
      "seo_snapshots",
      "product_images",
      "product_specs",
      "product_categories",
      "product_attribute_values",
      "product_relations",
      "collection_products",
      "product_models",
      "attributes",
      "addresses",
    ]) {
      expect(await tablePriv("nl_admin", table, "DELETE")).toBe(true);
    }
    await allowed(admin(), sql`delete from order_items`);
    await allowed(admin(), sql`delete from banners`);
    await allowed(admin(), sql`delete from product_images`);
    await allowed(admin(), sql`delete from shipping_methods`);
  });
});

// ═══ nl_worker ══════════════════════════════════════════════════════════════════════════════════

describe("roles: nl_worker", () => {
  it.skipIf(!DB)("nl_worker has no access to staff_users", async () => {
    for (const table of ["staff_users", "staff_roles", "staff_sessions", "webauthn_credentials", "addresses"]) {
      expect(await tableGrants("nl_worker", table)).toEqual([]);
      expect(await tablePriv("nl_worker", table, "SELECT")).toBe(false);
    }
    await denied(worker(), sql`select count(*) from staff_users`);
    await denied(worker(), sql`select count(*) from addresses`);
  });

  it.skipIf(!DB)("nl_worker has full DML on jobs", async () => {
    await allowed(
      worker(),
      sql`insert into jobs (id, type, unique_key) values ('0000000000000000000GRNT02', 'sms.send', 'k1')`,
    );
    await allowed(worker(), sql`update jobs set status = 'running', locked_by = 'w1', locked_at = now()`);
    await allowed(worker(), sql`select count(*) from jobs`);
    await allowed(worker(), sql`delete from jobs where status = 'done'`);
    const left = await rows<{ n: number }>(sql`select count(*)::int as n from jobs`);
    expect(left[0]?.n).toBe(1);
  });

  it.skipIf(!DB)("nl_worker can update products price/compare_at/rating/view_count only", async () => {
    await seed();
    await allowed(
      worker(),
      sql`update products set price = 1000, compare_at_price = 1200, price_updated_at = now(),
                              rating_avg = 4.5, rating_count = 2, view_count = 7`,
    );
    await denied(worker(), sql`update products set slug = 'hacked'`);
    await denied(worker(), sql`update products set stock_qty = 99`);
    await denied(worker(), sql`update products set status = 'archived'`);
    await denied(worker(), sql`update products set cost_price = 1`);
    await denied(worker(), sql`insert into products (slug, name, display_name) values ('x', 'x', 'x')`);
  });

  it.skipIf(!DB)("nl_worker can execute nl_events_ensure_partitions and nl_events_drop_old_partitions", async () => {
    await allowed(worker(), sql`select nl_events_ensure_partitions(2)`);
    await allowed(worker(), sql`select nl_events_drop_old_partitions(13)`);
    await allowed(worker(), sql`select nl_fa_norm('كيك')`);
    // Only the worker gets the partition maintenance functions.
    await denied(web(), sql`select nl_events_ensure_partitions(2)`);
    await denied(admin(), sql`select nl_events_drop_old_partitions(13)`);
  });

  it.skipIf(!DB)("nl_worker can delete otp_codes, sessions, rate_limits, done jobs", async () => {
    for (const table of ["otp_codes", "sessions", "rate_limits", "jobs", "carts", "cart_items", "wishlists"]) {
      expect(await tablePriv("nl_worker", table, "DELETE")).toBe(true);
    }
    await allowed(worker(), sql`delete from otp_codes where expires_at < now()`);
    await allowed(worker(), sql`delete from sessions where expires_at < now()`);
    await allowed(worker(), sql`delete from rate_limits where window_start < now()`);
    await allowed(worker(), sql`delete from jobs where status = 'done'`);
  });

  it.skipIf(!DB)("nl_worker cannot delete orders, customers, media", async () => {
    await denied(worker(), sql`delete from orders`);
    await denied(worker(), sql`delete from customers`);
    await denied(worker(), sql`delete from media`);
    await denied(worker(), sql`delete from order_items`);
    for (const table of ["orders", "customers", "media", "order_items", "reviews"]) {
      expect(await tablePriv("nl_worker", table, "DELETE")).toBe(false);
    }
  });
});

describe("roles: nl_media_fold (migration 0009)", () => {
  const DUP = "01HZX0000000000000000000D1";
  const TWIN = "01HZX0000000000000000000T1";

  it.skipIf(!DB)("nl_worker folds a duplicate upload into its twin, links included — and still cannot delete media itself", async () => {
    const { productId } = await seedMinimal(db());
    await db().execute(sql`insert into media (id, kind, source, storage_key, mime, bytes) values (${TWIN}, 'image', 'seed', 'products/1/twin.jpg', 'image/jpeg', 10), (${DUP}, 'image', 'seed', 'tmp/dup.jpg', 'image/jpeg', 10)`);
    await db().execute(sql`insert into product_images (product_id, media_id, role) values (${productId}, ${DUP}, 'primary')`);
    await allowed(worker(), sql`select nl_media_fold(${DUP}, ${TWIN})`);
    const left = await rows<{ id: string }>(sql`select id from media order by id`);
    expect(left.map((r) => r.id)).toEqual([TWIN]);
    const links = await rows<{ media_id: string; role: string }>(sql`select media_id, role from product_images where product_id = ${productId}`);
    expect(links).toEqual([{ media_id: TWIN, role: "primary" }]);
    await denied(worker(), sql`delete from media`);
  });

  it.skipIf(!DB)("nl_media_fold refuses a row that is not an unprocessed upload, and web/admin may not call it", async () => {
    await db().execute(sql`insert into media (id, kind, source, storage_key, mime, bytes) values (${TWIN}, 'image', 'seed', 'products/1/twin.jpg', 'image/jpeg', 10), (${DUP}, 'image', 'seed', 'products/1/done.jpg', 'image/jpeg', 10)`);
    await expect(worker().execute(sql`select nl_media_fold(${DUP}, ${TWIN})`)).rejects.toThrow();
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from media`))[0]?.n).toBe(2);
    await denied(web(), sql`select nl_media_fold(${DUP}, ${TWIN})`);
    await denied(admin(), sql`select nl_media_fold(${DUP}, ${TWIN})`);
  });
});

// ═══ append-only and never-delete ═══════════════════════════════════════════════════════════════

describe("roles: append-only and never-delete tables", () => {
  it.skipIf(!DB)("no role can delete from products", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`delete from products`);
      expect(await tablePriv(role, "products", "DELETE")).toBe(false);
    }
  });

  it.skipIf(!DB)("no role can delete from customers", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`delete from customers`);
      expect(await tablePriv(role, "customers", "DELETE")).toBe(false);
    }
  });

  it.skipIf(!DB)("no role can delete orders/payments", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`delete from orders`);
      await denied(client, sql`delete from payments`);
      await denied(client, sql`delete from refunds`);
      for (const table of ["orders", "payments", "refunds"]) {
        expect(await tablePriv(role, table, "DELETE")).toBe(false);
      }
    }
  });

  it.skipIf(!DB)("no role can delete posts/pages", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`delete from posts`);
      await denied(client, sql`delete from pages`);
      for (const table of ["posts", "pages"]) {
        expect(await tablePriv(role, table, "DELETE")).toBe(false);
      }
    }
  });

  it.skipIf(!DB)("no role can delete brands/categories/collections", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`delete from brands`);
      await denied(client, sql`delete from categories`);
      await denied(client, sql`delete from collections`);
      for (const table of ["brands", "categories", "collections"]) {
        expect(await tablePriv(role, table, "DELETE")).toBe(false);
      }
    }
  });

  it.skipIf(!DB)("audit_log rejects UPDATE/DELETE for every app role", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`update audit_log set action = 'x'`);
      await denied(client, sql`delete from audit_log`);
      expect(await tablePriv(role, "audit_log", "UPDATE")).toBe(false);
      expect(await tablePriv(role, "audit_log", "DELETE")).toBe(false);
      expect(await tablePriv(role, "audit_log", "INSERT")).toBe(true);
    }
  });

  it.skipIf(!DB)("loyalty_ledger rejects UPDATE/DELETE for every app role", async () => {
    for (const [role, client] of Object.entries(byRole())) {
      await denied(client, sql`update loyalty_ledger set delta = 1`);
      await denied(client, sql`delete from loyalty_ledger`);
      expect(await tablePriv(role, "loyalty_ledger", "UPDATE")).toBe(false);
      expect(await tablePriv(role, "loyalty_ledger", "DELETE")).toBe(false);
      expect(await tablePriv(role, "loyalty_ledger", "INSERT")).toBe(true);
    }
  });

  it.skipIf(!DB)(
    "inventory_movements, order_events, price_history, security_events reject UPDATE/DELETE for every app role",
    async () => {
      const appendOnly = ["inventory_movements", "order_events", "price_history", "security_events"];
      for (const [role, client] of Object.entries(byRole())) {
        for (const table of appendOnly) {
          await denied(client, sql`update ${sql.identifier(table)} set created_at = now()`);
          await denied(client, sql`delete from ${sql.identifier(table)}`);
          expect(await tablePriv(role, table, "UPDATE")).toBe(false);
          expect(await tablePriv(role, table, "DELETE")).toBe(false);
        }
      }
    },
  );
});
