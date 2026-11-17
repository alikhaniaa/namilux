import { customers, eq, shippingMethods, staffRoles, staffUsers } from "@namilux/db";
import type { Db } from "@namilux/db";
import { hashPassword } from "../../auth/password";
import { ulid } from "../../ids";
import { createManualOrder, submitManualOrder } from "../../orders/manual";
import { DEFAULT_SETTINGS } from "../../settings/schema";
import type { Actor, Order, OrderAddressSnapshot, Settings } from "../../types";

export const SETTINGS: Settings = DEFAULT_SETTINGS;
export const SITE_ORIGIN = "http://localhost:3000";

export const ADDRESS: OrderAddressSnapshot = {
  label: "خانه",
  recipientName: "علی رضایی",
  recipientPhone: "09121234567",
  province: "THR",
  city: "تهران",
  address: "خیابان ولیعصر، کوچهٔ سوم",
  plaque: null,
  unit: null,
  postcode: "1234567890",
};

/** The seeded nationwide method - idempotent by key. */
export async function ensureShipping(db: Db): Promise<void> {
  const existing = await db.select({ id: shippingMethods.id }).from(shippingMethods).where(eq(shippingMethods.key, "free_nationwide")).limit(1);
  if (existing[0] !== undefined) return;
  await db.insert(shippingMethods).values({ key: "free_nationwide", name: "ارسال رایگان", kind: "free", rateJson: {}, etaMinDays: 2, etaMaxDays: 7, isActive: true });
}

let staffSeq = 0;
/** A real staff row (role + user) so foreign keys on refunds/questions accept the actor id. */
export async function staffActor(db: Db, role = "owner"): Promise<Actor & { email: string; password: string }> {
  const roleRows = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, role)).limit(1);
  let roleId = roleRows[0]?.id;
  if (roleId === undefined) {
    const inserted = await db.insert(staffRoles).values({ name: role, permissions: [] }).returning({ id: staffRoles.id });
    roleId = inserted[0]!.id;
  }
  staffSeq += 1;
  const id = ulid();
  const email = `staff${String(staffSeq)}-${id.slice(-6).toLowerCase()}@namilux.test`;
  const password = "CorrectHorseBattery9x";
  await db.insert(staffUsers).values({ id, email, name: "کارمند آزمون", passwordHash: await hashPassword(password), roleId, isActive: true, mustChangePassword: false });
  return { type: "staff", id, email, password };
}

let phoneSeq = 2_000_000;
/** A customer with a unique 0912 number; `over` patches the row (birthday, tier, …). */
export async function makeCustomer(db: Db, over: Partial<typeof customers.$inferInsert> = {}): Promise<{ id: string; phone: string }> {
  phoneSeq += 1;
  const id = ulid();
  const phone = `0912${String(phoneSeq)}`;
  await db.insert(customers).values({ id, phone, referralCode: ulid().slice(-8), ...over });
  return { id, phone };
}

type OrderSpec = { productId: number; customerId: string; phone?: string; qty?: number; unitPriceOverride?: number };

/** Draft → «mark paid» (cash): a paid order with a succeeded manual payment row. */
export async function paidOrder(db: Db, spec: OrderSpec, actor: Actor): Promise<Order> {
  await ensureShipping(db);
  const phone = spec.phone ?? (await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, spec.customerId)).limit(1))[0]?.phone ?? "09121234567";
  const draft = await createManualOrder(
    db,
    {
      customerId: spec.customerId,
      phone,
      items: [{ productId: spec.productId, qty: spec.qty ?? 1, ...(spec.unitPriceOverride === undefined ? {} : { unitPriceOverride: spec.unitPriceOverride, overrideReason: "آزمون" }) }],
      shippingMethodKey: "free_nationwide",
      address: ADDRESS,
      source: "phone",
      settle: { kind: "manual", method: "cash", reference: "test-cash" },
    },
    actor,
    { settings: SETTINGS },
  );
  return submitManualOrder(db, draft.id, "mark_paid", actor, { settings: SETTINGS, env: { SITE_ORIGIN }, manual: { method: "cash", reference: "test-cash" } });
}

/** Draft → payment link: a pending_payment order holding stock reservations. */
export async function pendingOrder(db: Db, spec: OrderSpec, actor: Actor): Promise<Order> {
  await ensureShipping(db);
  const phone = spec.phone ?? (await db.select({ phone: customers.phone }).from(customers).where(eq(customers.id, spec.customerId)).limit(1))[0]?.phone ?? "09121234567";
  const draft = await createManualOrder(
    db,
    {
      customerId: spec.customerId,
      phone,
      items: [{ productId: spec.productId, qty: spec.qty ?? 1 }],
      shippingMethodKey: "free_nationwide",
      address: ADDRESS,
      source: "phone",
      settle: { kind: "payment_link" },
    },
    actor,
    { settings: SETTINGS },
  );
  return submitManualOrder(db, draft.id, "payment_link", actor, { settings: SETTINGS, env: { SITE_ORIGIN } });
}
