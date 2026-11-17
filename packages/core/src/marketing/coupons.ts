import { type Db, and, couponRedemptions, coupons, desc, eq, orders, sql } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import type { Actor, Coupon, CouponScope, Paged } from "../types";
import type { CouponAdminInput } from "../validation/marketing";

export const COUPONS_PAGE_SIZE = 50;

type Row = typeof coupons.$inferSelect;

function mapCoupon(r: Row, usedCount: number): Coupon {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    value: r.value,
    minSubtotal: r.minSubtotal,
    maxDiscount: r.maxDiscount,
    startsAt: r.startsAt === null ? null : r.startsAt.toISOString(),
    endsAt: r.endsAt === null ? null : r.endsAt.toISOString(),
    usageLimit: r.usageLimit,
    usagePerCustomer: r.usagePerCustomer,
    firstOrderOnly: r.firstOrderOnly,
    customerId: r.customerId,
    applies: r.appliesJson,
    excludes: r.excludesJson,
    stackableWithPoints: r.stackableWithPoints,
    isActive: r.isActive,
    usedCount,
    createdAt: r.createdAt.toISOString(),
  };
}

/** exactOptionalPropertyTypes: the jsonb column type has no `undefined` slots, so absent keys are dropped, never copied. */
function scope(s: CouponAdminInput["applies"]): CouponScope {
  const out: CouponScope = {};
  if (s.brandIds !== undefined) out.brandIds = s.brandIds;
  if (s.categoryIds !== undefined) out.categoryIds = s.categoryIds;
  if (s.collectionIds !== undefined) out.collectionIds = s.collectionIds;
  if (s.productIds !== undefined) out.productIds = s.productIds;
  return out;
}

const usedCountSql = sql<number>`(select count(*)::int from coupon_redemptions cr where cr.coupon_id = ${coupons.id})`;

export async function listCoupons(db: Db, q: { q?: string; active?: boolean; page?: number }): Promise<Paged<Coupon>> {
  const page = Math.max(1, q.page ?? 1);
  const conds = [];
  if (q.active !== undefined) conds.push(eq(coupons.isActive, q.active));
  if (q.q !== undefined && q.q.trim() !== "") conds.push(sql`${coupons.code} ilike ${`%${q.q.trim().toUpperCase()}%`}`);
  const where = conds.length === 0 ? undefined : and(...conds);
  const [rows, totalRows] = await Promise.all([
    db
      .select({ r: coupons, used: usedCountSql })
      .from(coupons)
      .where(where)
      .orderBy(desc(coupons.createdAt))
      .limit(COUPONS_PAGE_SIZE)
      .offset((page - 1) * COUPONS_PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(coupons).where(where),
  ]);
  return { items: rows.map((x) => mapCoupon(x.r, Number(x.used))), total: Number(totalRows[0]?.n ?? 0), page, pageSize: COUPONS_PAGE_SIZE };
}

export async function getCoupon(db: Db, id: number): Promise<Coupon | null> {
  const rows = await db.select({ r: coupons, used: usedCountSql }).from(coupons).where(eq(coupons.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : mapCoupon(row.r, Number(row.used));
}

export async function upsertCoupon(db: Db, input: CouponAdminInput, actor: Actor): Promise<{ id: number }> {
  const values = {
    code: input.code.toUpperCase(),
    kind: input.kind,
    value: input.value,
    minSubtotal: input.minSubtotal,
    maxDiscount: input.maxDiscount ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    usageLimit: input.usageLimit ?? null,
    usagePerCustomer: input.usagePerCustomer,
    firstOrderOnly: input.firstOrderOnly,
    customerId: input.customerId ?? null,
    appliesJson: scope(input.applies),
    excludesJson: scope(input.excludes),
    stackableWithPoints: input.stackableWithPoints,
    isActive: input.isActive,
  };
  const dupe = await db
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.code, values.code), input.id === undefined ? sql`true` : sql`${coupons.id} <> ${input.id}`))
    .limit(1);
  if (dupe[0] !== undefined) throw appError("CONFLICT", { fa: "این کد قبلاً ثبت شده است" });

  if (input.id === undefined) {
    const inserted = await db
      .insert(coupons)
      .values({ ...values, ...(actor.type === "staff" && actor.id !== null ? { createdByStaffId: actor.id } : {}) })
      .returning({ id: coupons.id });
    const id = inserted[0]?.id;
    if (id === undefined) throw appError("INTERNAL");
    await audit.log(db, actor, "coupon.create", "coupons", String(id), null, { code: values.code, kind: values.kind, value: values.value });
    return { id };
  }
  const before = await getCoupon(db, input.id);
  if (before === null) throw appError("NOT_FOUND", { fa: "کد تخفیف پیدا نشد" });
  await db.update(coupons).set(values).where(eq(coupons.id, input.id));
  await audit.log(db, actor, "coupon.update", "coupons", String(input.id), { code: before.code, value: before.value, isActive: before.isActive }, { code: values.code, value: values.value, isActive: values.isActive });
  return { id: input.id };
}

export async function setCouponActive(db: Db, id: number, active: boolean, actor: Actor): Promise<void> {
  const before = await getCoupon(db, id);
  if (before === null) throw appError("NOT_FOUND", { fa: "کد تخفیف پیدا نشد" });
  await db.update(coupons).set({ isActive: active }).where(eq(coupons.id, id));
  await audit.log(db, actor, "coupon.active", "coupons", String(id), { isActive: before.isActive }, { isActive: active });
}

export async function couponUsage(db: Db, id: number): Promise<{ orderCode: string; customerId: string | null; amount: number; at: string }[]> {
  const rows = await db
    .select({ code: orders.code, customerId: couponRedemptions.customerId, amount: couponRedemptions.amount, at: couponRedemptions.createdAt })
    .from(couponRedemptions)
    .innerJoin(orders, eq(orders.id, couponRedemptions.orderId))
    .where(eq(couponRedemptions.couponId, id))
    .orderBy(desc(couponRedemptions.createdAt))
    .limit(200);
  return rows.map((r) => ({ orderCode: r.code, customerId: r.customerId, amount: r.amount, at: r.at.toISOString() }));
}
