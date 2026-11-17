import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Table, View, is } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import type { Db, DbClient, NewRow, SQL } from "../index";
import {
  addresses,
  backInStockRequests,
  banners,
  brandProductCounts,
  carts,
  categories,
  couponRedemptions,
  coupons,
  createDb,
  customers,
  eq,
  events,
  getTableColumns,
  getTableName,
  inventoryMovements,
  inventoryReservations,
  jobs,
  loyaltyLedger,
  media,
  menus,
  metricsDaily,
  orderItems,
  orderStatus,
  orders,
  otpCodes,
  payments,
  posts,
  productCategories,
  productImages,
  productRelations,
  productSpecs,
  productWebColumns,
  products,
  questions,
  redirects,
  referrals,
  reviews,
  sessions,
  settings,
  shippingMethods,
  sql,
  staffRoles,
  staffUsers,
} from "../index";
import * as schemaBarrel from "../schema";
import type { TestDb } from "../test/helper";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "../test/helper";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The 57 tables of the spec (the view brand_product_counts is not a table). */
const DOC_TABLES: readonly string[] = [
  "addresses",
  "attributes",
  "audit_log",
  "back_in_stock_requests",
  "banners",
  "brands",
  "cart_items",
  "carts",
  "categories",
  "collection_products",
  "collections",
  "coupon_redemptions",
  "coupons",
  "customers",
  "events",
  "faqs",
  "inventory_movements",
  "inventory_reservations",
  "jobs",
  "loyalty_ledger",
  "media",
  "menus",
  "metrics_daily",
  "order_events",
  "order_items",
  "orders",
  "otp_codes",
  "pages",
  "payments",
  "posts",
  "price_alerts",
  "price_history",
  "product_attribute_values",
  "product_categories",
  "product_images",
  "product_models",
  "product_relations",
  "product_specs",
  "products",
  "questions",
  "rate_limits",
  "redirects",
  "referrals",
  "refunds",
  "reviews",
  "security_events",
  "seo_snapshots",
  "sessions",
  "settings",
  "shipments",
  "shipping_methods",
  "sms_log",
  "staff_roles",
  "staff_sessions",
  "staff_users",
  "webauthn_credentials",
  "wishlists",
];

/** Tables carrying `updated_at` + the BEFORE UPDATE trigger (migrations/0001_init.sql [M2]). */
const MUTABLE_TABLES: readonly string[] = [
  "brands",
  "categories",
  "collections",
  "product_models",
  "attributes",
  "media",
  "products",
  "customers",
  "addresses",
  "staff_roles",
  "staff_users",
  "carts",
  "shipping_methods",
  "coupons",
  "orders",
  "shipments",
  "reviews",
  "posts",
  "pages",
  "faqs",
  "menus",
  "banners",
  "redirects",
  "settings",
];

const DB = hasTestDb();

let handle: TestDb | undefined;

function db(): DbClient {
  if (handle === undefined) throw new Error("test database handle is not open");
  return handle.db;
}

beforeAll(async () => {
  if (DB) handle = await createTestDb();
});

afterAll(async () => {
  if (handle !== undefined) await handle.close();
});

afterEach(async () => {
  if (handle !== undefined) await truncateAll(handle.db);
});

async function rows<T extends Record<string, unknown>>(query: SQL): Promise<T[]> {
  return (await db().execute(query)) as unknown as T[];
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

/** 23505 = unique_violation, 23514 = check_violation, 23503 = foreign_key_violation. */
async function expectSqlState(op: PromiseLike<unknown>, code: string): Promise<void> {
  let got: string | null = null;
  try {
    await op;
  } catch (err: unknown) {
    got = sqlState(err);
  }
  expect(got).toBe(code);
}

let seq = 0;
/** 26-char Crockford-base32-shaped ids, unique per call (no generator in @namilux/db). */
function tid(): string {
  seq += 1;
  return `0000000000000000000SCHM${String(seq).padStart(3, "0")}`.slice(-26);
}

async function makeCustomer(phone: string): Promise<string> {
  const id = tid();
  await db()
    .insert(customers)
    .values({ id, phone, referralCode: `RC${String(seq).padStart(6, "0")}` });
  return id;
}

async function makeOrder(code: string, customerId?: string): Promise<string> {
  const id = tid();
  await db()
    .insert(orders)
    .values({ id, code, phone: "09121234567", ...(customerId === undefined ? {} : { customerId }) });
  return id;
}

async function makeMedia(): Promise<string> {
  const id = tid();
  await db()
    .insert(media)
    .values({ id, kind: "image", storageKey: `k/${id}`, mime: "image/avif", bytes: 1024, source: "seed" });
  return id;
}

async function makeStaff(email: string): Promise<string> {
  const [role] = await db()
    .insert(staffRoles)
    .values({ name: `role-${tid()}`, permissions: [] })
    .returning({ id: staffRoles.id });
  if (role === undefined) throw new Error("staff role insert returned nothing");
  const id = tid();
  await db().insert(staffUsers).values({ id, email, name: "Staff", passwordHash: "x", roleId: role.id });
  return id;
}

// ═══ schema barrel ══════════════════════════════════════════════════════════════════════════════

describe("schema barrel", () => {
  it("every table of the spec is exported (57 tables + 1 view)", () => {
    const values: unknown[] = Object.values(schemaBarrel);
    const exported = values
      .filter((value) => is(value, Table))
      .map((value) => getTableName(value))
      .sort();
    expect(exported).toEqual([...DOC_TABLES].sort());
    expect(exported).toHaveLength(57);

    const views = values.filter((value) => is(value, View));
    expect(views).toHaveLength(1);
    expect(is(brandProductCounts, View)).toBe(true);
  });

  it("index re-exports Db type and createDb", () => {
    expect(typeof createDb).toBe("function");
    expectTypeOf<ReturnType<typeof createDb>>().toEqualTypeOf<DbClient>();
    // A DbClient is usable everywhere core asks for a `Db` handle (13-CORE-API).
    const acceptsDb: (client: DbClient) => Db = (client) => client;
    expect(typeof acceptsDb).toBe("function");
  });

  it("relations compile with db.query (type-level)", () => {
    const query = async (client: DbClient): Promise<unknown> =>
      client.query.products.findFirst({
        with: { brand: true, specs: true, images: { with: { media: true } } },
      });
    expect(typeof query).toBe("function");
    expect(Object.keys(schemaBarrel).length).toBeGreaterThan(57);
  });
});

// ═══ columns ════════════════════════════════════════════════════════════════════════════════════

describe("columns", () => {
  it("money columns are bigint mode number", () => {
    for (const column of [products.price, orders.grandTotal, payments.amount, coupons.value]) {
      expect(column.getSQLType()).toBe("bigint");
      expect(column.dataType).toBe("number");
      expect(column.columnType).toBe("PgBigInt53");
    }
    expectTypeOf<NewRow<typeof payments>["amount"]>().toEqualTypeOf<number>();
  });

  it("ulid columns are text", () => {
    for (const column of [orders.id, customers.id, payments.id, media.id]) {
      expect(column.getSQLType()).toBe("text");
      expect(column.dataType).toBe("string");
    }
  });
});

// ═══ enums ══════════════════════════════════════════════════════════════════════════════════════

describe("enums", () => {
  it("enum values match the spec verbatim", () => {
    expect(schemaBarrel.productStatus.enumValues).toEqual(["draft", "active", "archived"]);
    expect(schemaBarrel.productVisibility.enumValues).toEqual(["public", "hidden", "link_only"]);
    expect(schemaBarrel.paymentStatus.enumValues).toEqual([
      "initiated",
      "redirected",
      "succeeded",
      "failed",
      "expired",
    ]);
    expect(schemaBarrel.movementReason.enumValues).toEqual([
      "sale",
      "restock",
      "adjust",
      "return",
      "cancel",
      "seed",
    ]);
    expect(schemaBarrel.loyaltyReason.enumValues).toEqual([
      "earn",
      "redeem",
      "expire",
      "adjust",
      "referral",
      "birthday",
      "review",
    ]);
    expect(schemaBarrel.customerTier.enumValues).toEqual(["member", "silver", "gold", "diamond"]);
    expect(schemaBarrel.otpPurpose.enumValues).toEqual(["login", "checkout", "verify_phone", "back_in_stock"]);
    expect(schemaBarrel.questionKind.enumValues).toEqual(["question", "price", "contact"]);
    expect(schemaBarrel.jobStatus.enumValues).toEqual(["queued", "running", "done", "failed", "dead"]);
  });

  it("order_status has 11 values", () => {
    expect(orderStatus.enumValues).toEqual([
      "draft",
      "pending_payment",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
      "refunded",
      "returned",
      "expired",
      "failed",
    ]);
    expect(orderStatus.enumValues).toHaveLength(11);
  });
});

// ═══ catalog ════════════════════════════════════════════════════════════════════════════════════

describe("catalog", () => {
  it("products insert type excludes search_text/is_on_request", () => {
    type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
    expectTypeOf<HasKey<NewRow<typeof products>, "searchText">>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<NewRow<typeof products>, "isOnRequest">>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<NewRow<typeof products>, "price">>().toEqualTypeOf<true>();
    expect(products.searchText.generated?.type).toBe("always");
    expect(products.isOnRequest.generated?.type).toBe("always");
  });

  it("productWebColumns has no costPrice", () => {
    expect(Object.keys(productWebColumns)).not.toContain("costPrice");
    expect(Object.keys(productWebColumns)).toContain("price");
    expect(Object.keys(productWebColumns)).toHaveLength(Object.keys(getTableColumns(products)).length - 1);
  });

  it("products.instalment_eligible is a NOT NULL boolean defaulting to true, visible to the web role", () => {
    expect(products.instalmentEligible.name).toBe("instalment_eligible");
    expect(products.instalmentEligible.columnType).toBe("PgBoolean");
    expect(products.instalmentEligible.notNull).toBe(true);
    expect(products.instalmentEligible.default).toBe(true);
    expect(Object.keys(productWebColumns)).toContain("instalmentEligible");
    expectTypeOf<NewRow<typeof products>["instalmentEligible"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("the 0006 migration is additive: the column (existing rows → true) plus guarded column grants", () => {
    const sqlText = readFileSync(path.join(PACKAGE_ROOT, "migrations/0008_product_instalment_eligible.sql"), "utf8");
    const statements = sqlText
      .split("--> statement-breakpoint")
      .map((part) =>
        part
          .split("\n")
          .filter((l) => !l.trimStart().startsWith("--") && l.trim() !== "")
          .join("\n")
          .trim(),
      )
      .filter((part) => part !== "");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('ALTER TABLE "products" ADD COLUMN "instalment_eligible" boolean DEFAULT true NOT NULL;');
    // Only the two column privileges roles.sql also lists - nothing wider, nothing destructive.
    const grants = statements[1] ?? "";
    expect(grants).toContain('GRANT SELECT ("instalment_eligible") ON "products" TO nl_web;');
    expect(grants).toContain('GRANT UPDATE ("instalment_eligible") ON "products" TO nl_admin;');
    expect(grants.match(/\bGRANT\b/g)).toHaveLength(2);
    expect(statements.join("\n")).not.toMatch(/\b(DROP|DELETE|TRUNCATE|REVOKE)\b/i);
  });

  it.skipIf(!DB)("instalment_eligible defaults to true on insert and persists false", async () => {
    await db().insert(products).values({ slug: "inst-default", name: "i", displayName: "i", price: 1_000 });
    const before = await db()
      .select({ instalmentEligible: products.instalmentEligible })
      .from(products)
      .where(eq(products.slug, "inst-default"));
    expect(before[0]?.instalmentEligible).toBe(true);

    await db().update(products).set({ instalmentEligible: false }).where(eq(products.slug, "inst-default"));
    const after = await db()
      .select({ instalmentEligible: products.instalmentEligible })
      .from(products)
      .where(eq(products.slug, "inst-default"));
    expect(after[0]?.instalmentEligible).toBe(false);
  });

  it.skipIf(!DB)("categories root slugs unique (nulls not distinct)", async () => {
    await db().insert(categories).values({ slug: "root-a", path: "root-a", name: "A" });
    await expectSqlState(
      db().insert(categories).values({ slug: "root-a", path: "root-a-second", name: "A2" }),
      "23505",
    );
    // A child with the same slug under a parent is fine.
    const parent = await db()
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.path, "root-a"));
    const parentRow = parent[0];
    if (parentRow === undefined) throw new Error("root category disappeared");
    await db()
      .insert(categories)
      .values({ parentId: parentRow.id, slug: "root-a", path: "root-a/root-a", name: "child" });
  });

  it.skipIf(!DB)("one primary category per product", async () => {
    const { productId } = await seedMinimal(db());
    const [second] = await db()
      .insert(categories)
      .values({ slug: "second", path: "second", name: "Second" })
      .returning({ id: categories.id });
    if (second === undefined) throw new Error("category insert returned nothing");
    await expectSqlState(
      db().insert(productCategories).values({ productId, categoryId: second.id, isPrimary: true }),
      "23505",
    );
    await db().insert(productCategories).values({ productId, categoryId: second.id, isPrimary: false });
  });

  it.skipIf(!DB)("one primary image per product", async () => {
    const { productId } = await seedMinimal(db());
    const first = await makeMedia();
    const second = await makeMedia();
    await db().insert(productImages).values({ productId, mediaId: first, role: "primary" });
    await expectSqlState(
      db().insert(productImages).values({ productId, mediaId: second, role: "primary" }),
      "23505",
    );
    await db().insert(productImages).values({ productId, mediaId: second, role: "gallery" });
  });

  it.skipIf(!DB)("self relation rejected", async () => {
    const { productId } = await seedMinimal(db());
    await expectSqlState(
      db().insert(productRelations).values({ productId, relatedId: productId, kind: "related" }),
      "23514",
    );
  });

  it.skipIf(!DB)("brand_product_counts counts only active public products", async () => {
    const { brandId } = await seedMinimal(db());
    await db().insert(products).values({
      slug: "draft-one",
      name: "draft",
      displayName: "draft",
      brandId,
      status: "draft",
      visibility: "public",
      price: 1_000,
    });
    await db().insert(products).values({
      slug: "hidden-one",
      name: "hidden",
      displayName: "hidden",
      brandId,
      status: "active",
      visibility: "hidden",
      price: 1_000,
    });
    await db().insert(products).values({
      slug: "on-request",
      name: "on request",
      displayName: "on request",
      brandId,
      status: "active",
      visibility: "public",
      price: 0,
    });

    const counts = await db()
      .select()
      .from(brandProductCounts)
      .where(eq(brandProductCounts.brandId, brandId));
    // seedMinimal's product (price 41.5M, stock 3) + the on-request one are active+public;
    // only the first is buyable (price > 0 and stock > 0).
    expect(counts[0]).toEqual({ brandId, total: 2, buyable: 1 });
  });

  it.skipIf(!DB)("search_text is nl_fa_norm of display_name/name/sku/model_code/color_name", async () => {
    await db().insert(products).values({
      slug: "norm-one",
      name: "يخچال",
      displayName: "يخچال ساید",
      sku: "KLF04",
      modelCode: "MC-1",
      colorName: "كرم",
      price: 1_000,
    });
    const found = await rows<{ search_text: string; expected: string }>(
      sql`select search_text,
                 nl_fa_norm(concat_ws(' ', display_name, name, sku, model_code, color_name)) as expected
          from products where slug = 'norm-one'`,
    );
    expect(found[0]?.search_text).toBe(found[0]?.expected);
    expect(found[0]?.search_text).toContain("یخچال");
    expect(found[0]?.search_text).toContain("کرم");
    expect(found[0]?.search_text).toContain("klf04");
    expect(found[0]?.search_text).not.toContain("ي");
  });

  it.skipIf(!DB)("is_on_request is true iff price = 0", async () => {
    await db()
      .insert(products)
      .values({ slug: "req-one", name: "r", displayName: "r", price: 0 });
    const before = await db()
      .select({ isOnRequest: products.isOnRequest })
      .from(products)
      .where(eq(products.slug, "req-one"));
    expect(before[0]?.isOnRequest).toBe(true);

    await db().update(products).set({ price: 1_000 }).where(eq(products.slug, "req-one"));
    const after = await db()
      .select({ isOnRequest: products.isOnRequest })
      .from(products)
      .where(eq(products.slug, "req-one"));
    expect(after[0]?.isOnRequest).toBe(false);
  });

  it.skipIf(!DB)("product.with images/specs/brand resolves under nl_migrate", async () => {
    const { productId } = await seedMinimal(db());
    const mediaId = await makeMedia();
    await db().insert(productImages).values({ productId, mediaId, role: "primary" });
    await db().insert(productSpecs).values({ productId, label: "capacity", value: "600" });

    const row = await db().query.products.findFirst({
      where: eq(products.id, productId),
      with: { brand: true, specs: true, images: { with: { media: true } } },
    });
    expect(row?.brand?.slug).toBe("smeg");
    expect(row?.specs).toHaveLength(1);
    expect(row?.images).toHaveLength(1);
    expect(row?.images[0]?.media?.id).toBe(mediaId);
  });
});

// ═══ customers ══════════════════════════════════════════════════════════════════════════════════

describe("customers", () => {
  it.skipIf(!DB)("customers phone check accepts 09… and del_…, rejects others", async () => {
    await makeCustomer("09121234567");
    await makeCustomer(`del_${tid()}`);
    await expectSqlState(
      db()
        .insert(customers)
        .values({ id: tid(), phone: "+989121234567", referralCode: "BAD00001" }),
      "23514",
    );
    await expectSqlState(
      db().insert(customers).values({ id: tid(), phone: "0912123456", referralCode: "BAD00002" }),
      "23514",
    );
    await expectSqlState(
      db().insert(customers).values({ id: tid(), phone: "del_short", referralCode: "BAD00003" }),
      "23514",
    );
  });

  it.skipIf(!DB)("addresses postcode must be 10 digits", async () => {
    const customerId = await makeCustomer("09121234567");
    const base = {
      customerId,
      label: "home",
      recipientName: "R",
      recipientPhone: "09121234567",
      province: "THR",
      city: "Tehran",
      address: "street",
    };
    await db().insert(addresses).values({ id: tid(), ...base, postcode: "1234567890" });
    await expectSqlState(
      db().insert(addresses).values({ id: tid(), ...base, postcode: "12345" }),
      "23514",
    );
    await expectSqlState(
      db().insert(addresses).values({ id: tid(), ...base, postcode: "۱۲۳۴۵۶۷۸۹۰" }),
      "23514",
    );
  });

  it.skipIf(!DB)("one default address per customer", async () => {
    const customerId = await makeCustomer("09121234567");
    const base = {
      customerId,
      label: "home",
      recipientName: "R",
      recipientPhone: "09121234567",
      province: "THR",
      city: "Tehran",
      address: "street",
      postcode: "1234567890",
    };
    await db().insert(addresses).values({ id: tid(), ...base, isDefault: true });
    await expectSqlState(
      db().insert(addresses).values({ id: tid(), ...base, isDefault: true }),
      "23505",
    );
    await db().insert(addresses).values({ id: tid(), ...base, isDefault: false });
  });
});

// ═══ auth ═══════════════════════════════════════════════════════════════════════════════════════

describe("auth", () => {
  it.skipIf(!DB)("staff email unique case-insensitively", async () => {
    await makeStaff("Owner@Namilux.IR");
    await expectSqlState(makeStaff("owner@namilux.ir"), "23505");
  });

  it.skipIf(!DB)("session token hash unique", async () => {
    const customerId = await makeCustomer("09121234567");
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db().insert(sessions).values({ id: tid(), customerId, tokenHash: "hash-1", expiresAt });
    await expectSqlState(
      db().insert(sessions).values({ id: tid(), customerId, tokenHash: "hash-1", expiresAt }),
      "23505",
    );
  });

  it.skipIf(!DB)("otp max_attempts default 5", async () => {
    const id = tid();
    await db().insert(otpCodes).values({
      id,
      phone: "09121234567",
      purpose: "login",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 180_000),
    });
    const found = await db()
      .select({ maxAttempts: otpCodes.maxAttempts, attempts: otpCodes.attempts })
      .from(otpCodes)
      .where(eq(otpCodes.id, id));
    expect(found[0]).toEqual({ maxAttempts: 5, attempts: 0 });
  });
});

// ═══ commerce ═══════════════════════════════════════════════════════════════════════════════════

describe("commerce", () => {
  it.skipIf(!DB)("coupon code must be uppercase", async () => {
    await db().insert(coupons).values({ code: "NAMILUX10", kind: "percent", value: 10 });
    await expectSqlState(
      db().insert(coupons).values({ code: "namilux20", kind: "percent", value: 20 }),
      "23514",
    );
  });

  it.skipIf(!DB)("one cart per customer", async () => {
    const customerId = await makeCustomer("09121234567");
    await db().insert(carts).values({ id: tid(), customerId });
    await expectSqlState(db().insert(carts).values({ id: tid(), customerId }), "23505");
  });

  it.skipIf(!DB)("one redemption per order", async () => {
    const orderId = await makeOrder("NL-AAAA1");
    const [coupon] = await db()
      .insert(coupons)
      .values({ code: "ONCE10", kind: "fixed", value: 10_000 })
      .returning({ id: coupons.id });
    if (coupon === undefined) throw new Error("coupon insert returned nothing");
    await db().insert(couponRedemptions).values({ couponId: coupon.id, orderId, amount: 10_000 });
    await expectSqlState(
      db().insert(couponRedemptions).values({ couponId: coupon.id, orderId, amount: 10_000 }),
      "23505",
    );
  });

  it.skipIf(!DB)("shipping_methods key unique", async () => {
    await db().insert(shippingMethods).values({ key: "post", name: "Post", kind: "flat" });
    await expectSqlState(
      db().insert(shippingMethods).values({ key: "post", name: "Post 2", kind: "free" }),
      "23505",
    );
  });
});

// ═══ orders ═════════════════════════════════════════════════════════════════════════════════════

describe("orders", () => {
  it.skipIf(!DB)("grand_total check rejects inconsistent totals", async () => {
    await expectSqlState(
      db().insert(orders).values({
        id: tid(),
        code: "NL-BBBB1",
        phone: "09121234567",
        subtotal: 100_000,
        shippingTotal: 20_000,
        grandTotal: 100_000,
      }),
      "23514",
    );
    await db().insert(orders).values({
      id: tid(),
      code: "NL-BBBB2",
      phone: "09121234567",
      subtotal: 100_000,
      discountTotal: 10_000,
      pointsDiscount: 5_000,
      shippingTotal: 20_000,
      grandTotal: 105_000,
    });
    await expectSqlState(
      db().insert(orders).values({
        id: tid(),
        code: "NL-BBBB3",
        phone: "09121234567",
        subtotal: -1,
        grandTotal: -1,
      }),
      "23514",
    );
  });

  it.skipIf(!DB)("line_total check rejects unit_price*qty mismatch", async () => {
    const { productId } = await seedMinimal(db());
    const orderId = await makeOrder("NL-CCCC1");
    await expectSqlState(
      db().insert(orderItems).values({
        id: tid(),
        orderId,
        productId,
        name: "item",
        unitPrice: 100_000,
        qty: 2,
        lineTotal: 300_000,
      }),
      "23514",
    );
    await db().insert(orderItems).values({
      id: tid(),
      orderId,
      productId,
      name: "item",
      unitPrice: 100_000,
      qty: 2,
      lineTotal: 200_000,
    });
  });

  it.skipIf(!DB)("second succeeded payment rejected", async () => {
    const orderId = await makeOrder("NL-DDDD1");
    await db()
      .insert(payments)
      .values({ id: tid(), orderId, driver: "zarinpal", amount: 100_000, status: "succeeded" });
    await expectSqlState(
      db()
        .insert(payments)
        .values({ id: tid(), orderId, driver: "zarinpal", amount: 100_000, status: "succeeded" }),
      "23505",
    );
    // A second *failed* attempt is fine.
    await db()
      .insert(payments)
      .values({ id: tid(), orderId, driver: "zarinpal", amount: 100_000, status: "failed" });
  });

  it.skipIf(!DB)("reservation cannot be released and consumed", async () => {
    const { productId } = await seedMinimal(db());
    const orderId = await makeOrder("NL-EEEE1");
    const now = new Date();
    await expectSqlState(
      db().insert(inventoryReservations).values({
        id: tid(),
        productId,
        orderId,
        qty: 1,
        expiresAt: now,
        releasedAt: now,
        consumedAt: now,
      }),
      "23514",
    );
    await expectSqlState(
      db()
        .insert(inventoryReservations)
        .values({ id: tid(), productId, orderId, qty: 0, expiresAt: now }),
      "23514",
    );
    await db()
      .insert(inventoryReservations)
      .values({ id: tid(), productId, orderId, qty: 1, expiresAt: now, consumedAt: now });
  });

  it.skipIf(!DB)("movement delta zero rejected", async () => {
    const { productId } = await seedMinimal(db());
    await expectSqlState(
      db()
        .insert(inventoryMovements)
        .values({ productId, delta: 0, reason: "adjust", actorType: "system" }),
      "23514",
    );
  });

  it.skipIf(!DB)("inventory movement trigger updates stock_qty", async () => {
    const { productId } = await seedMinimal(db());
    const before = await db()
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, productId));
    expect(before[0]?.stockQty).toBe(3);

    await db()
      .insert(inventoryMovements)
      .values({ productId, delta: -1, reason: "sale", actorType: "customer" });
    await db()
      .insert(inventoryMovements)
      .values({ productId, delta: 5, reason: "restock", actorType: "staff" });

    const after = await db()
      .select({ stockQty: products.stockQty })
      .from(products)
      .where(eq(products.id, productId));
    expect(after[0]?.stockQty).toBe(7);

    const sum = await rows<{ total: number }>(
      sql`select coalesce(sum(delta), 0)::int as total from inventory_movements where product_id = ${productId}`,
    );
    expect(sum[0]?.total).toBe(7);
  });

  it.skipIf(!DB)("invoice (year, no) unique", async () => {
    await db()
      .insert(orders)
      .values({ id: tid(), code: "NL-FFFF1", phone: "09121234567", invoiceYear: 1404, invoiceNo: 1 });
    await expectSqlState(
      db()
        .insert(orders)
        .values({ id: tid(), code: "NL-FFFF2", phone: "09121234567", invoiceYear: 1404, invoiceNo: 1 }),
      "23505",
    );
    // Same number in the next Jalali year is fine; so are many orders without an invoice.
    await db()
      .insert(orders)
      .values({ id: tid(), code: "NL-FFFF3", phone: "09121234567", invoiceYear: 1405, invoiceNo: 1 });
    await makeOrder("NL-FFFF4");
    await makeOrder("NL-FFFF5");
    await expectSqlState(
      db()
        .insert(orders)
        .values({ id: tid(), code: "NL-FFFF6", phone: "09121234567", invoiceNo: 9 }),
      "23514",
    );
  });

  it.skipIf(!DB)("order code format NL-XXXXX enforced", async () => {
    await makeOrder("NL-7Q2F4");
    for (const bad of ["nl-7q2f4", "NL-7Q2F", "NL-7Q2F44", "7Q2F4", "NL-7q2f4"]) {
      await expectSqlState(
        db().insert(orders).values({ id: tid(), code: bad, phone: "09121234567" }),
        "23514",
      );
    }
  });
});

// ═══ loyalty ════════════════════════════════════════════════════════════════════════════════════

describe("loyalty", () => {
  it.skipIf(!DB)("ledger delta zero rejected", async () => {
    const customerId = await makeCustomer("09121234567");
    await expectSqlState(
      db().insert(loyaltyLedger).values({ customerId, delta: 0, reason: "adjust" }),
      "23514",
    );
  });

  it.skipIf(!DB)("ledger trigger updates points_balance", async () => {
    const customerId = await makeCustomer("09121234567");
    await db().insert(loyaltyLedger).values({ customerId, delta: 50, reason: "earn" });
    await db().insert(loyaltyLedger).values({ customerId, delta: -20, reason: "redeem" });
    const found = await db()
      .select({ pointsBalance: customers.pointsBalance })
      .from(customers)
      .where(eq(customers.id, customerId));
    expect(found[0]?.pointsBalance).toBe(30);
  });

  it.skipIf(!DB)("referral referee unique", async () => {
    const referrer = await makeCustomer("09121234567");
    const other = await makeCustomer("09121234568");
    const referee = await makeCustomer("09121234569");
    await db().insert(referrals).values({ referrerId: referrer, refereeId: referee });
    await expectSqlState(
      db().insert(referrals).values({ referrerId: other, refereeId: referee }),
      "23505",
    );
  });

  it.skipIf(!DB)("referral self rejected", async () => {
    const customerId = await makeCustomer("09121234567");
    await expectSqlState(
      db().insert(referrals).values({ referrerId: customerId, refereeId: customerId }),
      "23514",
    );
  });
});

// ═══ requests ═══════════════════════════════════════════════════════════════════════════════════

describe("requests", () => {
  it.skipIf(!DB)("one waiting back-in-stock per product+phone", async () => {
    const { productId } = await seedMinimal(db());
    const firstId = tid();
    await db()
      .insert(backInStockRequests)
      .values({ id: firstId, productId, phone: "09121234567" });
    await expectSqlState(
      db().insert(backInStockRequests).values({ id: tid(), productId, phone: "09121234567" }),
      "23505",
    );
    // After the worker marks the first one notified, a new request is allowed again.
    await db()
      .update(backInStockRequests)
      .set({ status: "notified", notifiedAt: new Date() })
      .where(eq(backInStockRequests.id, firstId));
    await db().insert(backInStockRequests).values({ id: tid(), productId, phone: "09121234567" });
    await expectSqlState(
      db().insert(backInStockRequests).values({ id: tid(), productId, phone: "0912" }),
      "23514",
    );
  });

  it.skipIf(!DB)("review rating outside 1..5 rejected", async () => {
    const { productId } = await seedMinimal(db());
    const customerId = await makeCustomer("09121234568");
    for (const rating of [0, 6, -1]) {
      await expectSqlState(
        db().insert(reviews).values({ id: tid(), productId, customerId, rating, body: "b" }),
        "23514",
      );
    }
    await db().insert(reviews).values({ id: tid(), productId, customerId, rating: 5, body: "b" });
  });

  it.skipIf(!DB)("one review per product per customer", async () => {
    const { productId } = await seedMinimal(db());
    const customerId = await makeCustomer("09121234568");
    await db().insert(reviews).values({ id: tid(), productId, customerId, rating: 4, body: "b" });
    await expectSqlState(
      db().insert(reviews).values({ id: tid(), productId, customerId, rating: 5, body: "again" }),
      "23505",
    );
  });

  it.skipIf(!DB)(
    "contact question without product allowed; product question without product rejected",
    async () => {
      const { productId } = await seedMinimal(db());
      await db()
        .insert(questions)
        .values({ id: tid(), kind: "contact", phone: "09121234567", body: "hello" });
      await db()
        .insert(questions)
        .values({ id: tid(), kind: "question", productId, phone: "09121234567", body: "q" });
      await db()
        .insert(questions)
        .values({ id: tid(), kind: "price", productId, phone: "09121234567", body: "p" });
      await expectSqlState(
        db().insert(questions).values({ id: tid(), kind: "question", phone: "09121234567", body: "q" }),
        "23514",
      );
      await expectSqlState(
        db()
          .insert(questions)
          .values({ id: tid(), kind: "contact", productId, phone: "09121234567", body: "c" }),
        "23514",
      );
    },
  );
});

// ═══ content ════════════════════════════════════════════════════════════════════════════════════

describe("content", () => {
  it("posts insert type excludes search_text", () => {
    type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;
    expectTypeOf<HasKey<NewRow<typeof posts>, "searchText">>().toEqualTypeOf<false>();
    expectTypeOf<HasKey<NewRow<typeof posts>, "title">>().toEqualTypeOf<true>();
    expect(posts.searchText.generated?.type).toBe("always");
  });

  it.skipIf(!DB)("redirect code must be 301 or 410", async () => {
    await db()
      .insert(redirects)
      .values({ fromPath: "/old/", toPath: "/new/", code: 301, source: "legacy" });
    await db()
      .insert(redirects)
      .values({ fromPath: "/gone/", toPath: "/", code: 410, source: "legacy" });
    await expectSqlState(
      db()
        .insert(redirects)
        .values({ fromPath: "/temp/", toPath: "/new/", code: 302, source: "manual" }),
      "23514",
    );
  });

  it.skipIf(!DB)("redirect from_path must start with /", async () => {
    await db()
      .insert(redirects)
      .values({ fromPath: "/locations.kml", toPath: "/", code: 301, source: "legacy" });
    await expectSqlState(
      db()
        .insert(redirects)
        .values({ fromPath: "locations.kml", toPath: "/", code: 301, source: "legacy" }),
      "23514",
    );
    await expectSqlState(
      db()
        .insert(redirects)
        .values({ fromPath: "https://namilux.ir/x/", toPath: "/", code: 301, source: "manual" }),
      "23514",
    );
  });

  it.skipIf(!DB)("menu key unique", async () => {
    await db().insert(menus).values({ key: "header", itemsJson: [] });
    await expectSqlState(db().insert(menus).values({ key: "header", itemsJson: [] }), "23505");
  });

  it.skipIf(!DB)("banner window check", async () => {
    const now = Date.now();
    await db().insert(banners).values({
      slot: "home_hero",
      startsAt: new Date(now),
      endsAt: new Date(now + 86_400_000),
    });
    await db().insert(banners).values({ slot: "promo_bar", startsAt: new Date(now) });
    await expectSqlState(
      db().insert(banners).values({
        slot: "home_band",
        startsAt: new Date(now + 86_400_000),
        endsAt: new Date(now),
      }),
      "23514",
    );
  });
});

// ═══ system ═════════════════════════════════════════════════════════════════════════════════════

describe("system", () => {
  it.skipIf(!DB)("jobs unique_key idempotent", async () => {
    await db().insert(jobs).values({ id: tid(), type: "sms.send", uniqueKey: "sms:1" });
    await expectSqlState(
      db().insert(jobs).values({ id: tid(), type: "sms.send", uniqueKey: "sms:1" }),
      "23505",
    );
    // The unique index is partial: any number of rows without a unique_key coexist.
    await db().insert(jobs).values({ id: tid(), type: "metrics.rollup" });
    await db().insert(jobs).values({ id: tid(), type: "metrics.rollup" });
    const inserted = await db()
      .insert(jobs)
      .values({ id: tid(), type: "sms.send", uniqueKey: "sms:1" })
      .onConflictDoNothing()
      .returning({ id: jobs.id });
    expect(inserted).toEqual([]);
  });

  it.skipIf(!DB)("events PK includes ts", async () => {
    const pk = await rows<{ column_name: string }>(
      sql`select kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
          where tc.table_schema = 'public' and tc.table_name = 'events' and tc.constraint_type = 'PRIMARY KEY'
          order by kcu.ordinal_position`,
    );
    expect(pk.map((r) => r.column_name)).toEqual(["id", "ts"]);

    await db().insert(events).values({
      type: "page_view",
      path: "/",
      sessionHash: "hash",
      uaClass: "mobile",
    });
    const count = await rows<{ n: number }>(sql`select count(*)::int as n from events`);
    expect(count[0]?.n).toBe(1);
  });

  it.skipIf(!DB)("metrics_daily dim defaults to ''", async () => {
    await db().insert(metricsDaily).values({ day: "2026-08-25", metric: "orders", value: "12" });
    const found = await db()
      .select({ dim: metricsDaily.dim, value: metricsDaily.value })
      .from(metricsDaily);
    expect(found[0]?.dim).toBe("");
    // (day, metric, dim) is the PK, so the same metric twice on one day conflicts.
    await expectSqlState(
      db().insert(metricsDaily).values({ day: "2026-08-25", metric: "orders", value: "13" }),
      "23505",
    );
    await db()
      .insert(metricsDaily)
      .values({ day: "2026-08-25", metric: "404", dim: "/missing/", value: "3" });
  });

  it.skipIf(!DB)("settings key is PK", async () => {
    const pk = await rows<{ column_name: string }>(
      sql`select kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name and kcu.constraint_schema = tc.constraint_schema
          where tc.table_schema = 'public' and tc.table_name = 'settings' and tc.constraint_type = 'PRIMARY KEY'
          order by kcu.ordinal_position`,
    );
    expect(pk.map((r) => r.column_name)).toEqual(["key"]);

    await db().insert(settings).values({ key: "commerce", valueJson: { pendingTtlMin: 30 } });
    await expectSqlState(
      db().insert(settings).values({ key: "commerce", valueJson: { pendingTtlMin: 45 } }),
      "23505",
    );
  });

  it.skipIf(!DB)("updated_at trigger bumps updated_at on every mutable table", async () => {
    const triggers = await rows<{ table_name: string }>(
      sql`select c.relname as table_name
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and t.tgname = 'set_updated_at' and not t.tgisinternal`,
    );
    const covered = triggers.map((r) => r.table_name).sort();
    expect(covered).toEqual([...MUTABLE_TABLES].sort());

    const { productId } = await seedMinimal(db());
    const readProduct = async (): Promise<{ updatedAt: Date; viewCount: number }> => {
      const found = await db()
        .select({ updatedAt: products.updatedAt, viewCount: products.viewCount })
        .from(products)
        .where(eq(products.id, productId));
      if (found[0] === undefined) throw new Error("product disappeared");
      return found[0];
    };

    const initial = await readProduct();
    await db().update(products).set({ name: "renamed" }).where(eq(products.id, productId));
    const renamed = await readProduct();
    expect(renamed.updatedAt.getTime()).toBeGreaterThan(initial.updatedAt.getTime());

    // DECISION: products/posts carry GENERATED columns, whose value in NEW is NULL inside a BEFORE
    // trigger, so `to_jsonb(NEW) - excluded IS DISTINCT FROM to_jsonb(OLD) - excluded` is true for
    // *every* update of those two tables - the TG_ARGV ignore list (stock_qty, view_count,
    // rating_*) has no effect there today. Asserted as it behaves; raised in
    // the spec rather than patched (0001_init.sql is DONE and out of scope).
    await db().update(products).set({ viewCount: 42 }).where(eq(products.id, productId));
    const viewed = await readProduct();
    expect(viewed.viewCount).toBe(42);
    expect(viewed.updatedAt.getTime()).toBeGreaterThanOrEqual(renamed.updatedAt.getTime());

    // On a table without generated columns the ignore list works as documented: a no-op UPDATE
    // leaves updated_at alone.

    const [brand] = await db()
      .insert(schemaBarrel.brands)
      .values({ slug: "bump", nameFa: "B", nameEn: "B" })
      .returning({ id: schemaBarrel.brands.id, updatedAt: schemaBarrel.brands.updatedAt });
    if (brand === undefined) throw new Error("brand insert returned nothing");
    const brandUpdatedAt = async (): Promise<number> => {
      const found = await db()
        .select({ updatedAt: schemaBarrel.brands.updatedAt })
        .from(schemaBarrel.brands)
        .where(eq(schemaBarrel.brands.id, brand.id));
      if (found[0] === undefined) throw new Error("brand disappeared");
      return found[0].updatedAt.getTime();
    };

    await db()
      .update(schemaBarrel.brands)
      .set({ nameFa: "B" })
      .where(eq(schemaBarrel.brands.id, brand.id));
    expect(await brandUpdatedAt()).toBe(brand.updatedAt.getTime());

    await db()
      .update(schemaBarrel.brands)
      .set({ claim: "changed" })
      .where(eq(schemaBarrel.brands.id, brand.id));
    expect(await brandUpdatedAt()).toBeGreaterThan(brand.updatedAt.getTime());
  });
});
