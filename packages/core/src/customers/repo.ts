import type { Db } from "@namilux/db";
import {
  type Row,
  addresses as addressesTable,
  and,
  count,
  customers,
  desc,
  eq,
  gte,
  inArray,
  notInArray,
  orders,
  sql,
} from "@namilux/db";
import type { CustomerTier } from "../constants";
import { appError } from "../errors";
import { shortCode, ulid } from "../ids";
import { faNorm } from "../persian";
import type { Customer, CustomerQuery, CustomerRow, CustomersPage } from "../types";

type CustomerRowSource = Row<typeof customers>;

function iso(d: Date | string | null): string | null {
  if (d === null) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function toCustomer(r: CustomerRowSource): Customer {
  return {
    id: r.id,
    phone: r.phone,
    phoneVerifiedAt: iso(r.phoneVerifiedAt),
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    birthday: r.birthday,
    gender: r.gender,
    tier: r.tier,
    pointsBalance: r.pointsBalance,
    referralCode: r.referralCode,
    referredById: r.referredById,
    marketingOptIn: r.marketingOptIn,
    isBlocked: r.isBlocked,
    blockReason: r.blockReason,
    adminNote: r.adminNote,
    lastLoginAt: iso(r.lastLoginAt),
    ordersCount: r.ordersCount,
    lifetimeSpend: r.lifetimeSpend,
    createdAt: iso(r.createdAt) as string,
  };
}

export async function findById(db: Db, id: string): Promise<Customer | null> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  return rows[0] === undefined ? null : toCustomer(rows[0]);
}

export async function findByPhone(db: Db, phone: string): Promise<Customer | null> {
  const rows = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  return rows[0] === undefined ? null : toCustomer(rows[0]);
}

export async function createForPhone(
  db: Db,
  phone: string,
  meta: { referredBy?: string | null },
): Promise<Customer> {
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = shortCode(8);
    const inserted = await db
      .insert(customers)
      .values({
        id: ulid(),
        phone,
        phoneVerifiedAt: now,
        referralCode,
        referredById: meta.referredBy ?? null,
        lastLoginAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted[0] !== undefined) return toCustomer(inserted[0]);
    // phone conflict → the customer already exists (concurrent verify); re-select and return it
    const existing = await findByPhone(db, phone);
    if (existing !== null) return existing;
    // otherwise the conflict was on referral_code - retry with a fresh code
  }
  throw appError("INTERNAL", { details: "could not allocate a unique referral code" });
}

/**
 * Turn a verified phone into an account: find-or-create, stamping phone_verified_at and last_login_at
 * to now on every successful verification. Idempotent under a race (createForPhone resolves the
 * phone conflict). Called by auth/otp.verifyOtp; the blocked check stays in the caller.
 */
export async function upsertByPhone(db: Db, phone: string): Promise<{ customer: Customer; isNew: boolean }> {
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = await db
      .insert(customers)
      .values({ id: ulid(), phone, phoneVerifiedAt: now, referralCode: shortCode(8), lastLoginAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted[0] !== undefined) return { customer: toCustomer(inserted[0]), isNew: true };
    // phone conflict → the account exists; stamp this verification and return it (isNew = false)
    const existing = await findByPhone(db, phone);
    if (existing !== null) {
      const rows = await db
        .update(customers)
        .set({ phoneVerifiedAt: now, lastLoginAt: now })
        .where(eq(customers.id, existing.id))
        .returning();
      const updated = rows[0];
      return { customer: updated === undefined ? existing : toCustomer(updated), isNew: false };
    }
    // no phone row → the conflict was on referral_code; retry with a fresh code
  }
  throw appError("INTERNAL", { details: "could not allocate a unique referral code" });
}

export async function updateProfile(
  db: Db,
  id: string,
  patch: Partial<Pick<Customer, "firstName" | "lastName" | "email" | "birthday" | "gender" | "marketingOptIn">>,
): Promise<Customer> {
  const set: Record<string, unknown> = {};
  if ("firstName" in patch) set.firstName = patch.firstName;
  if ("lastName" in patch) set.lastName = patch.lastName;
  if ("email" in patch) set.email = patch.email;
  if ("birthday" in patch) set.birthday = patch.birthday;
  if ("gender" in patch) set.gender = patch.gender;
  if ("marketingOptIn" in patch) set.marketingOptIn = patch.marketingOptIn;
  const rows = await db.update(customers).set(set).where(eq(customers.id, id)).returning();
  if (rows[0] === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  return toCustomer(rows[0]);
}

export async function touchLogin(db: Db, id: string, now?: Date): Promise<void> {
  await db
    .update(customers)
    .set({ lastLoginAt: now ?? sql`now()` })
    .where(eq(customers.id, id));
}

export async function bumpOrderCounters(db: Db, id: string, paidAmount: number): Promise<void> {
  await db
    .update(customers)
    .set({
      ordersCount: sql`${customers.ordersCount} + 1`,
      lifetimeSpend: sql`${customers.lifetimeSpend} + ${paidAmount}`,
    })
    .where(eq(customers.id, id));
}

export async function setBlocked(db: Db, id: string, blocked: boolean, reason: string | null): Promise<void> {
  await db
    .update(customers)
    .set({ isBlocked: blocked, blockReason: blocked ? reason : null })
    .where(eq(customers.id, id));
}

export async function setTier(db: Db, id: string, tier: CustomerTier): Promise<void> {
  await db.update(customers).set({ tier }).where(eq(customers.id, id));
}

export async function setPointsBalance(db: Db, id: string, balance: number): Promise<void> {
  await db.update(customers).set({ pointsBalance: balance }).where(eq(customers.id, id));
}

function customerFilters(q: CustomerQuery) {
  const conds = [];
  if (q.q !== undefined && q.q.trim() !== "") {
    // Names are stored faNorm'd (seed/write path), so folding the search term with faNorm makes an
    // Arabic-yeh query match a Persian-yeh name; phone is matched on the raw digits.
    const term = `%${faNorm(q.q.trim())}%`;
    conds.push(
      sql`(${customers.phone} like ${term} or ${customers.firstName} ilike ${term} or ${customers.lastName} ilike ${term})`,
    );
  }
  if (q.tier !== undefined && q.tier.length > 0) conds.push(inArray(customers.tier, q.tier));
  if (q.blocked !== undefined) conds.push(eq(customers.isBlocked, q.blocked));
  if (q.optIn !== undefined) conds.push(eq(customers.marketingOptIn, q.optIn));
  // A staff member confined to one storefront sees the people who bought THERE, and nobody else.
  if (q.channel !== undefined) conds.push(sql`exists (select 1 from orders o where o.customer_id = ${customers.id} and o.channel = ${q.channel})`);
  return conds.length === 0 ? undefined : and(...conds);
}

function toCustomerRow(r: CustomerRowSource, lastOrderAt: Date | string | null): CustomerRow {
  const name = [r.firstName, r.lastName].filter((s): s is string => s !== null && s !== "").join(" ");
  return {
    id: r.id,
    name: name === "" ? null : name,
    phoneMasked: `${r.phone.slice(0, 4)}***${r.phone.slice(-4)}`,
    tier: r.tier,
    ordersCount: r.ordersCount,
    lifetimeSpend: r.lifetimeSpend,
    lastOrderAt: iso(lastOrderAt),
    marketingOptIn: r.marketingOptIn,
    isBlocked: r.isBlocked,
    createdAt: iso(r.createdAt) as string,
  };
}

/**
 * The customer's latest order, for the list's «آخرین سفارش» column - on the list's storefront when
 * it is confined to one. It used to be passed as null, so the column read «ثبت نشده» for everyone.
 */
function lastOrderSql(channel: CustomerQuery["channel"]) {
  return channel === undefined
    ? sql<Date | string | null>`(select max(o.placed_at) from orders o where o.customer_id = ${customers.id})`
    : sql<Date | string | null>`(select max(o.placed_at) from orders o where o.customer_id = ${customers.id} and o.channel = ${channel})`;
}

export async function listAdmin(db: Db, q: CustomerQuery): Promise<CustomersPage> {
  const where = customerFilters(q);
  const page = Math.max(1, q.page);
  const pageSize = q.pageSize;
  const rows = await db
    .select({ c: customers, lastOrderAt: lastOrderSql(q.channel) })
    .from(customers)
    .where(where)
    .orderBy(desc(customers.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const totals = await db.select({ n: count() }).from(customers).where(where);
  return {
    items: rows.map((r) => toCustomerRow(r.c, r.lastOrderAt)),
    total: totals[0]?.n ?? 0,
    page,
    pageSize,
  };
}

export async function* exportRows(db: Db, q: CustomerQuery): AsyncIterable<CustomerRow> {
  const where = customerFilters(q);
  const rows = await db.select({ c: customers, lastOrderAt: lastOrderSql(q.channel) }).from(customers).where(where).orderBy(desc(customers.createdAt));
  for (const r of rows) yield toCustomerRow(r.c, r.lastOrderAt);
}

export async function anonymize(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(addressesTable).where(eq(addressesTable.customerId, id));
    await tx
      .update(customers)
      .set({
        phone: `del_${ulid()}`,
        firstName: null,
        lastName: null,
        email: null,
        birthday: null,
        gender: null,
        marketingOptIn: false,
        adminNote: null,
      })
      .where(eq(customers.id, id));
  });
}

export async function twelveMonthSpend(db: Db, id: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${orders.grandTotal}), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, id),
        gte(orders.paidAt, since),
        notInArray(orders.status, ["refunded", "returned", "cancelled"]),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
