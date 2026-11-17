import { type Db, and, count, eq, inArray, orders } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import type { SalesChannel } from "../channel";
import type { Actor, Address, BackInStockRequest, Customer, CustomerQuery, CustomersPage, LoyaltyLedgerEntry, OrderRow, Review, SessionUser } from "../types";
import type { ProfileInput } from "../validation/auth";
import { type SessionInfo, listSessions, revokeAllSessions } from "../auth/sessions";
import { loyalty } from "../loyalty/ledger";
import { listForCustomer } from "../orders/repo";
import { backInStock } from "../requests/back-in-stock";
import { reviews } from "../reviews/reviews";
import { addresses } from "./addresses";
import * as repo from "./repo";

export async function getCustomer(db: Db, id: string): Promise<Customer | null> {
  return repo.findById(db, id);
}

export async function ensureCustomerForPhone(
  db: Db,
  phone: string,
  ctx: { referralCode?: string | null },
): Promise<{ customer: Customer; isNew: boolean }> {
  // DECISION: referral attribution (ctx.referralCode → referred_by) is a members-club concern (F-062,
  // P1). It is accepted here for signature stability but linked when the club lands (M7); the P0 login
  // path only needs create-or-load + the blocked guard.
  void ctx;
  const { customer, isNew } = await repo.upsertByPhone(db, phone);
  if (customer.isBlocked) {
    throw appError("FORBIDDEN", { fa: "حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید" });
  }
  return { customer, isNew };
}

export async function updateProfile(db: Db, id: string, input: ProfileInput, actor: Actor): Promise<Customer> {
  const before = await repo.findById(db, id);
  if (before === null) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  const patch: Partial<Pick<Customer, "firstName" | "lastName" | "email" | "birthday" | "gender" | "marketingOptIn">> = {
    firstName: input.firstName,
    lastName: input.lastName,
  };
  if (input.email !== undefined) patch.email = input.email === null ? null : input.email.toLowerCase();
  if (input.gender !== undefined) patch.gender = input.gender;
  if (input.marketingOptIn !== undefined) patch.marketingOptIn = input.marketingOptIn;
  // birthday is set once by the customer; staff may overwrite it
  if (input.birthday !== undefined && (before.birthday === null || actor.type === "staff")) {
    patch.birthday = input.birthday;
  }
  const after = await repo.updateProfile(db, id, patch);
  await audit.log(db, actor, "customer.profile.update", "customers", id, before, after);
  return after;
}

export async function blockCustomer(db: Db, id: string, reason: string, actor: Actor): Promise<void> {
  await repo.setBlocked(db, id, true, reason);
  await revokeAllSessions(db, id);
  await reviews.hideAllFor(db, id, actor);
  await audit.log(db, actor, "customer.block", "customers", id, null, { reason });
}

export async function unblockCustomer(db: Db, id: string, actor: Actor): Promise<void> {
  await repo.setBlocked(db, id, false, null);
  await audit.log(db, actor, "customer.unblock", "customers", id, null, null);
}

export async function anonymizeCustomer(db: Db, id: string, actor: Actor): Promise<void> {
  const pending = await db
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.customerId, id), inArray(orders.status, ["pending_payment", "paid", "processing", "shipped"])));
  if ((pending[0]?.n ?? 0) > 0) throw appError("CONFLICT", { fa: "این مشتری سفارش در جریان دارد" });
  await repo.anonymize(db, id);
  await revokeAllSessions(db, id);
  await audit.log(db, actor, "customer.anonymize", "customers", id, null, null);
}

export async function customerDetail(db: Db, id: string, opts: { channel?: SalesChannel } = {}): Promise<{
  customer: Customer;
  orders: OrderRow[];
  addresses: Address[];
  ledger: LoyaltyLedgerEntry[];
  reviews: Review[];
  requests: BackInStockRequest[];
  sessions: SessionInfo[];
}> {
  const customer = await repo.findById(db, id);
  if (customer === null) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  // Confined to one storefront: a customer who never ordered there does not exist for this reader,
  // and one who did shows that site's orders and addresses only - not the loyalty ledger, reviews,
  // back-in-stock requests or sessions, which belong to the main site's account.
  if (opts.channel !== undefined) {
    const channel = opts.channel;
    const bought = await db.select({ n: count() }).from(orders).where(and(eq(orders.customerId, id), eq(orders.channel, channel)));
    if ((bought[0]?.n ?? 0) === 0) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
    const [addrs, orderPage] = await Promise.all([addresses.list(db, id), listForCustomer(db, id, 1, channel)]);
    return { customer, orders: orderPage.items, addresses: addrs, ledger: [], reviews: [], requests: [], sessions: [] };
  }
  // M8 (admin customer screen): the related lists come from their own modules - first page each,
  // newest first; the screen paginates nothing beyond that (the spec shows the recent history).
  const [addrs, sessions, orderPage, ledgerPage, reviewRows, requestRows] = await Promise.all([
    addresses.list(db, id),
    listSessions(db, id),
    listForCustomer(db, id, 1),
    loyalty.history(db, id, 1),
    reviews.listForCustomer(db, id),
    backInStock.listForCustomer(db, id),
  ]);
  return { customer, orders: orderPage.items, addresses: addrs, ledger: ledgerPage.items, reviews: reviewRows, requests: requestRows, sessions };
}

export async function listCustomers(db: Db, q: CustomerQuery): Promise<CustomersPage> {
  return repo.listAdmin(db, q);
}

export function publicView(c: Customer): SessionUser {
  // DECISION: SessionUser (types/common) carries sessionId + lastOtpAt which a bare Customer lacks;
  // publicView fills sessionId empty (the handler already holds the real session) and maps lastOtpAt
  // to last_login_at. adminNote/blockReason/counters are simply not part of SessionUser.
  return {
    customerId: c.id,
    phone: c.phone,
    phoneVerifiedAt: c.phoneVerifiedAt,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    tier: c.tier,
    pointsBalance: c.pointsBalance,
    isBlocked: c.isBlocked,
    sessionId: "",
    lastOtpAt: c.lastLoginAt,
  };
}
