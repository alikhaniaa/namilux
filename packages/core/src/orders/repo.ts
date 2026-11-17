import {
  type Db,
  and,
  asc,
  desc,
  eq,
  inArray,
  lt,
  orderItems,
  orders,
  payments as paymentsTbl,
  refunds as refundsTbl,
  shipments as shipmentsTbl,
  sql,
} from "@namilux/db";
import type { SalesChannel } from "../channel";
import { ORDER_STATUSES } from "../constants";
import type { OrderStatus } from "../constants";
import { orderCode, ulid } from "../ids";
import { maskPhone, normalizePhone } from "../persian";
import { appError } from "../errors";
import type {
  DateRange,
  Order,
  OrderAddressSnapshot,
  OrderItem,
  OrderQuery,
  OrderRow,
  OrderShippingSnapshot,
  OrdersPage,
  Paged,
  Payment,
  Refund,
  Shipment,
} from "../types";

export type NewOrder = Omit<Order, "id" | "code" | "createdAt" | "updatedAt" | "events" | "items"> & { items: Omit<OrderItem, "id" | "orderId">[] };
export type NewPayment = Omit<Payment, "id" | "createdAt" | "verifiedAt">;
export type NewRefund = Omit<Refund, "id" | "createdAt" | "doneAt">;
export type NewShipment = Omit<Shipment, "id">;

const ORDERS_PAGE_SIZE = 20;
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** The row a just-executed insert+select must have returned. */
function first<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw appError("INTERNAL", { details: "expected a row but got none" });
  return row;
}

// The DB jsonb `$type` for the shipping snapshot names its eta fields etaMinDays/etaMaxDays, while the
// domain OrderShippingSnapshot (../types) uses etaMin/etaMax; convert at the repo boundary so the
// stored JSON stays consistent for every reader (admin included).
type DbShipping = { key: string; name: string; etaMinDays: number; etaMaxDays: number; cost: number };
const EMPTY_SHIPPING: DbShipping = { key: "", name: "", etaMinDays: 0, etaMaxDays: 0, cost: 0 };
const toDbShipping = (s: OrderShippingSnapshot): DbShipping => ({ key: s.key, name: s.name, etaMinDays: s.etaMin, etaMaxDays: s.etaMax, cost: s.cost });
const fromDbShipping = (s: DbShipping | null): OrderShippingSnapshot => {
  const v = s ?? EMPTY_SHIPPING;
  return { key: v.key, name: v.name, etaMin: v.etaMinDays, etaMax: v.etaMaxDays, cost: v.cost };
};

type OrderRowDb = typeof orders.$inferSelect;
type DbAddress = NonNullable<OrderRowDb["addressSnapshotJson"]>;
// The order snapshot drops the address-book `label` (not part of the DB AddressSnapshot) and reads
// province back as a ProvinceCode.
const toDbAddress = (a: OrderAddressSnapshot): DbAddress => ({
  recipientName: a.recipientName,
  recipientPhone: a.recipientPhone,
  province: a.province,
  city: a.city,
  address: a.address,
  plaque: a.plaque,
  unit: a.unit,
  postcode: a.postcode,
});
const EMPTY_ADDRESS: OrderAddressSnapshot = { label: "", recipientName: "", recipientPhone: "", province: "THR", city: "", address: "", plaque: null, unit: null, postcode: "" };
const fromDbAddress = (s: DbAddress | null): OrderAddressSnapshot =>
  s === null
    ? EMPTY_ADDRESS
    : { label: "", recipientName: s.recipientName, recipientPhone: s.recipientPhone, province: s.province as OrderAddressSnapshot["province"], city: s.city, address: s.address, plaque: s.plaque ?? null, unit: s.unit ?? null, postcode: s.postcode };

type ItemRowDb = typeof orderItems.$inferSelect;

function mapItem(r: ItemRowDb): OrderItem {
  return {
    id: r.id,
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    modelCode: r.modelCode,
    colorName: r.colorName,
    imageKey: r.imageKey,
    unitPrice: Number(r.unitPrice),
    compareAtPrice: r.compareAtPrice === null ? null : Number(r.compareAtPrice),
    qty: r.qty,
    lineTotal: Number(r.lineTotal),
    warrantyMonths: r.warrantyMonths,
  };
}

function mapOrder(row: OrderRowDb, items: OrderItem[]): Order {
  return {
    id: row.id,
    code: row.code,
    invoiceNo: row.invoiceNo,
    customerId: row.customerId,
    phone: row.phone,
    email: row.email,
    status: row.status,
    source: row.source as Order["source"],
    channel: row.channel,
    channelRef: row.channelRef,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discountTotal),
    shippingTotal: Number(row.shippingTotal),
    pointsDiscount: Number(row.pointsDiscount),
    grandTotal: Number(row.grandTotal),
    couponId: row.couponId,
    couponCode: row.couponCode,
    pointsRedeemed: row.pointsRedeemed,
    pointsEarned: row.pointsEarned,
    shippingMethodKey: row.shippingMethodKey ?? "",
    shipping: fromDbShipping(row.shippingSnapshotJson ?? null),
    address: fromDbAddress(row.addressSnapshotJson ?? null),
    customerNote: row.customerNote,
    adminNote: row.adminNote,
    giftMessage: row.giftMessage,
    isGift: row.isGift,
    items,
    placedAt: iso(row.placedAt) ?? row.createdAt.toISOString(),
    paidAt: iso(row.paidAt),
    shippedAt: iso(row.shippedAt),
    deliveredAt: iso(row.deliveredAt),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: row.cancelReason,
    expiresAt: iso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadItems(db: Db, orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const map = new Map<string, OrderItem[]>();
  if (orderIds.length === 0) return map;
  const rows = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds)).orderBy(asc(orderItems.id));
  for (const r of rows) map.set(r.orderId, [...(map.get(r.orderId) ?? []), mapItem(r)]);
  return map;
}

async function oneOrder(db: Db, row: OrderRowDb | undefined): Promise<Order | null> {
  if (row === undefined) return null;
  const items = (await loadItems(db, [row.id])).get(row.id) ?? [];
  return mapOrder(row, items);
}

/** Snapshot/date columns of the domain Order that map straight back to the table. */
function orderInsertValues(o: NewOrder, id: string, code: string): typeof orders.$inferInsert {
  return {
    id,
    code,
    invoiceNo: o.invoiceNo,
    customerId: o.customerId,
    phone: o.phone,
    email: o.email,
    status: o.status,
    source: o.source,
    channel: o.channel,
    channelRef: o.channelRef,
    subtotal: o.subtotal,
    discountTotal: o.discountTotal,
    shippingTotal: o.shippingTotal,
    pointsDiscount: o.pointsDiscount,
    grandTotal: o.grandTotal,
    couponId: o.couponId,
    couponCode: o.couponCode,
    pointsRedeemed: o.pointsRedeemed,
    pointsEarned: o.pointsEarned,
    shippingMethodKey: o.shippingMethodKey,
    shippingSnapshotJson: toDbShipping(o.shipping),
    addressSnapshotJson: toDbAddress(o.address),
    customerNote: o.customerNote,
    adminNote: o.adminNote,
    giftMessage: o.giftMessage,
    isGift: o.isGift,
    placedAt: o.placedAt === null ? null : new Date(o.placedAt),
    paidAt: o.paidAt === null ? null : new Date(o.paidAt),
    expiresAt: o.expiresAt === null ? null : new Date(o.expiresAt),
    cancelReason: o.cancelReason,
  };
}

export async function insertOrder(db: Db, o: NewOrder): Promise<Order> {
  const id = ulid();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = orderCode();
    try {
      await db.insert(orders).values(orderInsertValues(o, id, code));
      if (o.items.length > 0) {
        await db.insert(orderItems).values(
          o.items.map((it) => ({
            id: ulid(),
            orderId: id,
            productId: it.productId,
            name: it.name,
            sku: it.sku,
            modelCode: it.modelCode,
            colorName: it.colorName,
            imageKey: it.imageKey,
            unitPrice: it.unitPrice,
            compareAtPrice: it.compareAtPrice,
            qty: it.qty,
            lineTotal: it.lineTotal,
            warrantyMonths: it.warrantyMonths,
          })),
        );
      }
      const created = await findById(db, id);
      if (created === null) throw appError("INTERNAL", { details: "order vanished after insert" });
      return created;
    } catch (err: unknown) {
      // A 5-char order-code space collision → retry with a fresh code (the spec code is UNIQUE).
      // drizzle wraps the driver error (DrizzleQueryError → cause: PostgresError); look at the Postgres error itself
      const pg = (err instanceof Error && err.cause instanceof Error ? err.cause : err) as { code?: string; constraint_name?: string; message?: string };
      if (pg.code === "23505" && (pg.constraint_name === "orders_code_uq" || /orders_code_uq/.test(pg.message ?? ""))) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw appError("INTERNAL", { details: `could not allocate a unique order code: ${String(lastErr)}` });
}

export async function findById(db: Db, id: string): Promise<Order | null> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return oneOrder(db, rows[0]);
}

export async function findByCode(db: Db, code: string): Promise<Order | null> {
  const rows = await db.select().from(orders).where(eq(orders.code, code)).limit(1);
  return oneOrder(db, rows[0]);
}

export async function findByCodeAndPhone(db: Db, code: string, phone: string, channel?: Order["channel"]): Promise<Order | null> {
  const normalized = normalizePhone(phone);
  if (normalized === null) return null;
  const rows = await db.select().from(orders).where(and(eq(orders.code, code), eq(orders.phone, normalized), ...(channel === undefined ? [] : [eq(orders.channel, channel)]))).limit(1);
  return oneOrder(db, rows[0]);
}

/**
 * Orders still awaiting payment whose window has already closed - the worker's `order.expire`
 * reconcile set. `lt` skips NULL expiresAt rows (a NULL comparison is never true), so an order with
 * no deadline is never expired here. Batched; the handler processes at most `limit` per tick.
 */
export async function listDueForExpiry(db: Db, now: Date, limit = 200): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lt(orders.expiresAt, now)))
    .orderBy(asc(orders.expiresAt))
    .limit(limit);
  const out: Order[] = [];
  for (const row of rows) {
    const order = await oneOrder(db, row);
    if (order !== null) out.push(order);
  }
  return out;
}

/** Draft orders untouched since `before` (never advanced to payment) - cancelled as draft_stale. */
export async function listStaleDrafts(db: Db, before: Date, limit = 200): Promise<Order[]> {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.status, "draft"), lt(orders.createdAt, before)))
    .orderBy(asc(orders.createdAt))
    .limit(limit);
  const out: Order[] = [];
  for (const row of rows) {
    const order = await oneOrder(db, row);
    if (order !== null) out.push(order);
  }
  return out;
}

export async function lockForUpdate(db: Db, id: string): Promise<Order | null> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1).for("update");
  return oneOrder(db, rows[0]);
}

export async function updateStatus(
  db: Db,
  id: string,
  from: OrderStatus,
  to: OrderStatus,
  patch: Partial<Order> & { invoiceYear?: number },
): Promise<boolean> {
  const set: Partial<typeof orders.$inferInsert> = { status: to };
  if (patch.invoiceNo !== undefined) set.invoiceNo = patch.invoiceNo;
  if (patch.invoiceYear !== undefined) set.invoiceYear = patch.invoiceYear; // orders_invoice_pair: both or neither
  if (patch.pointsEarned !== undefined) set.pointsEarned = patch.pointsEarned;
  if (patch.paidAt !== undefined) set.paidAt = patch.paidAt === null ? null : new Date(patch.paidAt);
  if (patch.shippedAt !== undefined) set.shippedAt = patch.shippedAt === null ? null : new Date(patch.shippedAt);
  if (patch.deliveredAt !== undefined) set.deliveredAt = patch.deliveredAt === null ? null : new Date(patch.deliveredAt);
  if (patch.cancelledAt !== undefined) set.cancelledAt = patch.cancelledAt === null ? null : new Date(patch.cancelledAt);
  if (patch.cancelReason !== undefined) set.cancelReason = patch.cancelReason;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt === null ? null : new Date(patch.expiresAt);
  const rows = await db.update(orders).set(set).where(and(eq(orders.id, id), eq(orders.status, from))).returning({ id: orders.id });
  return rows.length === 1;
}

export async function updateOrder(
  db: Db,
  id: string,
  patch: Partial<Pick<Order, "adminNote" | "customerNote" | "address" | "shipping" | "shippingTotal" | "grandTotal" | "discountTotal" | "subtotal">>,
): Promise<void> {
  const set: Partial<typeof orders.$inferInsert> = {};
  if (patch.adminNote !== undefined) set.adminNote = patch.adminNote;
  if (patch.customerNote !== undefined) set.customerNote = patch.customerNote;
  if (patch.address !== undefined) set.addressSnapshotJson = toDbAddress(patch.address);
  if (patch.shipping !== undefined) set.shippingSnapshotJson = toDbShipping(patch.shipping);
  if (patch.shippingTotal !== undefined) set.shippingTotal = patch.shippingTotal;
  if (patch.grandTotal !== undefined) set.grandTotal = patch.grandTotal;
  if (patch.discountTotal !== undefined) set.discountTotal = patch.discountTotal;
  if (patch.subtotal !== undefined) set.subtotal = patch.subtotal;
  if (Object.keys(set).length === 0) return;
  await db.update(orders).set(set).where(eq(orders.id, id));
}

export async function replaceItems(db: Db, orderId: string, items: OrderItem[]): Promise<void> {
  // Admin edit before processing: order_items is not customer-facing history, so a rewrite is allowed.
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  if (items.length > 0) {
    await db.insert(orderItems).values(items.map((it) => ({ ...it, orderId })));
  }
}

/**
 * The list columns for a page of orders in three queries, whatever the page size: the line count,
 * the succeeded payment and the latest shipment of every order on the page. It used to be three
 * queries PER ROW - 150 round-trips for a 50-row admin page, 600 at 200.
 */
async function toOrderRows(db: Db, rows: OrderRowDb[]): Promise<OrderRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [lineCounts, paid, shipped, latest] = await Promise.all([
    db.select({ orderId: orderItems.orderId, n: sql<number>`count(*)::int` }).from(orderItems).where(inArray(orderItems.orderId, ids)).groupBy(orderItems.orderId),
    db
      .select({ orderId: paymentsTbl.orderId, status: paymentsTbl.status, driver: paymentsTbl.driver })
      .from(paymentsTbl)
      .where(and(inArray(paymentsTbl.orderId, ids), eq(paymentsTbl.status, "succeeded"))),
    db
      .selectDistinctOn([shipmentsTbl.orderId], { orderId: shipmentsTbl.orderId, status: shipmentsTbl.status })
      .from(shipmentsTbl)
      .where(inArray(shipmentsTbl.orderId, ids))
      .orderBy(shipmentsTbl.orderId, desc(shipmentsTbl.id)),
    db
      .selectDistinctOn([paymentsTbl.orderId], { orderId: paymentsTbl.orderId, driver: paymentsTbl.driver })
      .from(paymentsTbl)
      .where(inArray(paymentsTbl.orderId, ids))
      .orderBy(paymentsTbl.orderId, desc(paymentsTbl.createdAt)),
  ]);
  const lines = new Map(lineCounts.map((r) => [r.orderId, Number(r.n)]));
  const methods = new Map(latest.map((r) => [r.orderId, r.driver]));
  const pays = new Map<string, (typeof paid)[number]>();
  for (const p of paid) if (!pays.has(p.orderId)) pays.set(p.orderId, p);
  const ships = new Map(shipped.map((r) => [r.orderId, r.status]));
  return rows.map((row) => {
    const pay = pays.get(row.id);
    // The person the order is for - the recipient on its address. A phone order or an old import
    // may carry none, and the list falls back to the masked phone as before.
    const recipient = row.addressSnapshotJson?.recipientName?.trim() ?? "";
    return {
      id: row.id,
      code: row.code,
      customerName: recipient === "" ? null : recipient,
      phoneMasked: maskPhone(row.phone),
      itemsCount: lines.get(row.id) ?? 0,
      grandTotal: Number(row.grandTotal),
      status: row.status,
      paymentStatus: pay?.status ?? null,
      paymentDriver: (pay?.driver ?? null) as OrderRow["paymentDriver"],
      method: (methods.get(row.id) ?? null) as OrderRow["method"],
      shipmentStatus: ships.get(row.id) ?? null,
      source: row.source as OrderRow["source"],
      channel: row.channel,
      placedAt: iso(row.placedAt) ?? row.createdAt.toISOString(),
      hasNote: (row.customerNote ?? "") !== "" || (row.adminNote ?? "") !== "",
      flagged: false,
    };
  });
}

export async function listForCustomer(db: Db, customerId: string, page = 1, channel?: Order["channel"]): Promise<Paged<OrderRow>> {
  const offset = Math.max(0, (page - 1) * ORDERS_PAGE_SIZE);
  // One storefront's orders only: an order carries the prices of the site it was placed on, and
  // neither site may show the other's (core/channel.ts). No channel = every order (admin tools).
  const mine = channel === undefined ? eq(orders.customerId, customerId) : and(eq(orders.customerId, customerId), eq(orders.channel, channel));
  const [rows, counted] = await Promise.all([
    db.select().from(orders).where(mine).orderBy(desc(orders.placedAt), desc(orders.createdAt)).limit(ORDERS_PAGE_SIZE).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(mine),
  ]);
  const items = await toOrderRows(db, rows);
  return { items, total: counted[0]?.n ?? 0, page, pageSize: ORDERS_PAGE_SIZE };
}

/** The method of an order's latest payment attempt (null when it has none). */
const latestMethodSql = sql`(select p.driver from ${paymentsTbl} p where p.order_id = ${orders.id} order by p.created_at desc limit 1)`;

/**
 * A SnappPay order a person has to look at:
 * - verified but not settled yet (the shopper's credit is held, not taken);
 * - a refund whose gateway answer is not final (requested/processing);
 * - money taken on an order that is no longer live (expired/failed/cancelled = late success).
 */
export const snapppayAttentionSql = sql`(
  exists (select 1 from ${paymentsTbl} p where p.order_id = ${orders.id} and p.driver = 'snapppay'
          and p.status not in ('succeeded', 'failed', 'expired') and p.verified_at is not null)
  or exists (select 1 from ${refundsTbl} r join ${paymentsTbl} p on p.id = r.payment_id
             where r.order_id = ${orders.id} and p.driver = 'snapppay' and r.status in ('requested', 'processing'))
  or (${orders.status} in ('expired', 'failed', 'cancelled')
      and exists (select 1 from ${paymentsTbl} p where p.order_id = ${orders.id} and p.driver = 'snapppay' and p.status = 'succeeded'))
)`;

/** Every filter of the admin list, optionally without the storefront / method one (their counts). */
function adminListConds(q: OrderQuery, withChannel = true, withMethod = true) {
  const conds = [];
  if (withMethod && q.method !== undefined) conds.push(q.method === "none" ? sql`${latestMethodSql} is null` : sql`${latestMethodSql} = ${q.method}`);
  if (q.attention === true) conds.push(snapppayAttentionSql);
  if (q.status !== undefined && q.status.length > 0) conds.push(inArray(orders.status, q.status));
  if (q.source !== undefined && q.source.length > 0) conds.push(inArray(orders.source, q.source));
  if (withChannel && q.channel !== undefined) conds.push(eq(orders.channel, q.channel));
  if (q.customerId !== undefined) conds.push(eq(orders.customerId, q.customerId));
  if (typeof q.q === "string" && q.q !== "") conds.push(sql`(${orders.code} ilike ${"%" + q.q + "%"} or ${orders.phone} like ${"%" + q.q + "%"})`);
  if (q.from !== undefined) conds.push(sql`${orders.placedAt} >= ${q.from}::timestamptz`);
  if (q.to !== undefined) conds.push(sql`${orders.placedAt} <= ${q.to}::timestamptz`);
  if (q.shippingMethodKey !== undefined) conds.push(eq(orders.shippingMethodKey, q.shippingMethodKey));
  if (q.couponCode !== undefined) conds.push(eq(orders.couponCode, q.couponCode));
  if (q.province !== undefined) conds.push(sql`${orders.addressSnapshotJson}->>'province' = ${q.province}`);
  if (q.hasNote === true) conds.push(sql`(coalesce(${orders.customerNote}, '') <> '' or coalesce(${orders.adminNote}, '') <> '')`);
  if (q.hasNote === false) conds.push(sql`(coalesce(${orders.customerNote}, '') = '' and coalesce(${orders.adminNote}, '') = '')`);
  return conds;
}

export async function listAdmin(db: Db, q: OrderQuery): Promise<OrdersPage> {
  const conds = adminListConds(q);
  const where = conds.length === 0 ? undefined : and(...conds);
  const pageSize = q.pageSize;
  const offset = Math.max(0, (q.page - 1) * pageSize);
  const sortCol =
    q.sort === "placed_asc" ? asc(orders.placedAt) : q.sort === "total_desc" ? desc(orders.grandTotal) : q.sort === "total_asc" ? asc(orders.grandTotal) : desc(orders.placedAt);
  const [rows, counted] = await Promise.all([
    db.select().from(orders).where(where).orderBy(sortCol, desc(orders.createdAt)).limit(pageSize).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  const items = await toOrderRows(db, rows);
  return { items, total: counted[0]?.n ?? 0, page: q.page, pageSize };
}

/**
 * How many orders each storefront has under the list's OTHER filters - the numbers on the
 * «همه · نامی‌لوکس · اقساطی» switch above the orders table. One grouped query.
 */
export async function channelCounts(db: Db, q: OrderQuery): Promise<Record<SalesChannel, number>> {
  const conds = adminListConds(q, false);
  const rows = await db
    .select({ channel: orders.channel, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(conds.length === 0 ? undefined : and(...conds))
    .groupBy(orders.channel);
  const out: Record<SalesChannel, number> = { main: 0, instalments: 0 };
  for (const r of rows) out[r.channel] = Number(r.n);
  return out;
}

/** How many orders each payment method has under the list's OTHER filters (the method switch). */
export async function methodCounts(db: Db, q: OrderQuery): Promise<Record<string, number>> {
  const conds = adminListConds(q, true, false);
  const rows = await db
    .select({ method: sql<string | null>`${latestMethodSql}`, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(conds.length === 0 ? undefined : and(...conds))
    .groupBy(sql`1`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.method ?? "none"] = Number(r.n);
  return out;
}

/** SnappPay orders needing a person, store-wide (the attention chip and the status card). */
export async function snapppayAttentionCount(db: Db): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(snapppayAttentionSql);
  return Number(rows[0]?.n ?? 0);
}

export async function countPending(db: Db, customerId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), eq(orders.status, "pending_payment")));
  return rows[0]?.n ?? 0;
}

export async function expiredPending(db: Db, now: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lt(orders.expiresAt, now)))
    .limit(limit);
  return rows.map((r) => r.id);
}

function mapPayment(r: typeof paymentsTbl.$inferSelect): Payment {
  return {
    id: r.id,
    orderId: r.orderId,
    driver: r.driver as Payment["driver"],
    amount: Number(r.amount),
    status: r.status,
    authority: r.authority,
    refId: r.refId,
    cardPanMasked: r.cardPanMasked,
    fee: r.fee === null ? null : Number(r.fee),
    createdAt: r.createdAt.toISOString(),
    verifiedAt: iso(r.verifiedAt),
  };
}

export const payments = {
  async insert(db: Db, p: NewPayment): Promise<Payment> {
    const id = ulid();
    await db.insert(paymentsTbl).values({
      id,
      orderId: p.orderId,
      driver: p.driver,
      amount: p.amount,
      status: p.status,
      authority: p.authority,
      refId: p.refId,
      cardPanMasked: p.cardPanMasked,
      fee: p.fee,
    });
    const rows = await db.select().from(paymentsTbl).where(eq(paymentsTbl.id, id)).limit(1);
    return mapPayment(first(rows));
  },
  async findByAuthority(db: Db, authority: string): Promise<Payment | null> {
    const rows = await db.select().from(paymentsTbl).where(eq(paymentsTbl.authority, authority)).limit(1);
    return rows[0] === undefined ? null : mapPayment(rows[0]);
  },
  async update(db: Db, id: string, patch: Partial<Payment>): Promise<void> {
    const set: Partial<typeof paymentsTbl.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.authority !== undefined) set.authority = patch.authority;
    if (patch.refId !== undefined) set.refId = patch.refId;
    if (patch.cardPanMasked !== undefined) set.cardPanMasked = patch.cardPanMasked;
    if (patch.fee !== undefined) set.fee = patch.fee;
    if (patch.verifiedAt !== undefined) set.verifiedAt = patch.verifiedAt === null ? null : new Date(patch.verifiedAt);
    if (Object.keys(set).length === 0) return;
    await db.update(paymentsTbl).set(set).where(eq(paymentsTbl.id, id));
  },
  /**
   * SnappPay attempts still «redirected» on orders that have ended (expired/failed/cancelled) and
   * are older than half an hour: the shopper left SnappPay's page and no job closed the attempt.
   */
  async staleTwoPhase(db: Db, limit = 50): Promise<Payment[]> {
    const rows = await db
      .select({ p: paymentsTbl })
      .from(paymentsTbl)
      .innerJoin(orders, eq(orders.id, paymentsTbl.orderId))
      .where(and(
        eq(paymentsTbl.driver, "snapppay"),
        eq(paymentsTbl.status, "redirected"),
        inArray(orders.status, ["expired", "failed", "cancelled"]),
        sql`${paymentsTbl.createdAt} < now() - interval '30 minutes'`,
      ))
      .limit(limit);
    return rows.map((r) => mapPayment(r.p));
  },
  async listForOrder(db: Db, orderId: string): Promise<Payment[]> {
    const rows = await db.select().from(paymentsTbl).where(eq(paymentsTbl.orderId, orderId)).orderBy(desc(paymentsTbl.createdAt));
    return rows.map(mapPayment);
  },
  async succeededFor(db: Db, orderId: string): Promise<Payment | null> {
    const rows = await db.select().from(paymentsTbl).where(and(eq(paymentsTbl.orderId, orderId), eq(paymentsTbl.status, "succeeded"))).limit(1);
    return rows[0] === undefined ? null : mapPayment(rows[0]);
  },
};

function mapRefund(r: typeof refundsTbl.$inferSelect): Refund {
  return {
    id: r.id,
    paymentId: r.paymentId,
    orderId: r.orderId,
    amount: Number(r.amount),
    reason: r.reason,
    status: r.status,
    providerRef: r.providerRef,
    byStaffId: r.byStaffId,
    createdAt: r.createdAt.toISOString(),
    doneAt: iso(r.doneAt),
  };
}

export const refunds = {
  async insert(db: Db, r: NewRefund): Promise<Refund> {
    const id = ulid();
    await db.insert(refundsTbl).values({
      id,
      paymentId: r.paymentId,
      orderId: r.orderId,
      amount: r.amount,
      reason: r.reason,
      status: r.status,
      providerRef: r.providerRef,
      byStaffId: r.byStaffId,
    });
    const rows = await db.select().from(refundsTbl).where(eq(refundsTbl.id, id)).limit(1);
    return mapRefund(first(rows));
  },
  async update(db: Db, id: string, patch: Partial<Refund>): Promise<void> {
    const set: Partial<typeof refundsTbl.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.providerRef !== undefined) set.providerRef = patch.providerRef;
    if (patch.doneAt !== undefined) set.doneAt = patch.doneAt === null ? null : new Date(patch.doneAt);
    if (Object.keys(set).length === 0) return;
    await db.update(refundsTbl).set(set).where(eq(refundsTbl.id, id));
  },
  async listForOrder(db: Db, orderId: string): Promise<Refund[]> {
    const rows = await db.select().from(refundsTbl).where(eq(refundsTbl.orderId, orderId)).orderBy(desc(refundsTbl.createdAt));
    return rows.map(mapRefund);
  },
  async totalRefunded(db: Db, orderId: string): Promise<number> {
    const rows = await db
      .select({ s: sql<number>`coalesce(sum(${refundsTbl.amount}), 0)::bigint` })
      .from(refundsTbl)
      .where(and(eq(refundsTbl.orderId, orderId), eq(refundsTbl.status, "done")));
    return Number(rows[0]?.s ?? 0);
  },
};

function mapShipment(r: typeof shipmentsTbl.$inferSelect): Shipment {
  return {
    id: r.id,
    orderId: r.orderId,
    carrier: r.carrier,
    trackingCode: r.trackingCode,
    trackingUrl: r.trackingUrl,
    status: r.status,
    cost: r.cost === null ? null : Number(r.cost),
    shippedAt: iso(r.shippedAt),
    deliveredAt: iso(r.deliveredAt),
    note: r.note,
  };
}

export const shipments = {
  async insert(db: Db, s: NewShipment): Promise<Shipment> {
    const id = ulid();
    await db.insert(shipmentsTbl).values({
      id,
      orderId: s.orderId,
      carrier: s.carrier,
      trackingCode: s.trackingCode,
      trackingUrl: s.trackingUrl,
      status: s.status,
      cost: s.cost,
      shippedAt: s.shippedAt === null ? null : new Date(s.shippedAt),
      deliveredAt: s.deliveredAt === null ? null : new Date(s.deliveredAt),
      note: s.note,
    });
    const rows = await db.select().from(shipmentsTbl).where(eq(shipmentsTbl.id, id)).limit(1);
    return mapShipment(first(rows));
  },
  async update(db: Db, id: string, patch: Partial<Shipment>): Promise<void> {
    const set: Partial<typeof shipmentsTbl.$inferInsert> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.trackingCode !== undefined) set.trackingCode = patch.trackingCode;
    if (patch.trackingUrl !== undefined) set.trackingUrl = patch.trackingUrl;
    if (patch.shippedAt !== undefined) set.shippedAt = patch.shippedAt === null ? null : new Date(patch.shippedAt);
    if (patch.deliveredAt !== undefined) set.deliveredAt = patch.deliveredAt === null ? null : new Date(patch.deliveredAt);
    if (Object.keys(set).length === 0) return;
    await db.update(shipmentsTbl).set(set).where(eq(shipmentsTbl.id, id));
  },
  async latestFor(db: Db, orderId: string): Promise<Shipment | null> {
    const rows = await db.select().from(shipmentsTbl).where(eq(shipmentsTbl.orderId, orderId)).orderBy(desc(shipmentsTbl.id)).limit(1);
    return rows[0] === undefined ? null : mapShipment(rows[0]);
  },
};

/** Gapless per Jalali year, backed by a locked settings counter row (no dedicated table - the spec). */
export async function nextInvoiceNo(db: Db, jalaliYear: number): Promise<number> {
  // DECISION (M8 e2e): the counter lives in `settings` (key invoice.seq.<year>) which nl_web may only read,
  // yet the paid transition - reached from the gateway callback under nl_web - must allocate the number.
  // `nl_next_invoice_no` (migration 0002, SECURITY DEFINER, EXECUTE granted in roles.sql) takes a
  // transaction-scoped advisory lock on the counter name and upserts it, so numbers are gapless per
  // Jalali year for every role.
  const rows = await db.execute<{ n: number }>(sql`select nl_next_invoice_no(${Math.trunc(jalaliYear)}::int) as n`);
  const n = Number(rows[0]?.n ?? 0);
  if (!Number.isInteger(n) || n < 1) throw appError("INTERNAL", { details: "nl_next_invoice_no returned no number" });
  return n;
}

export async function salesStats(
  db: Db,
  range: DateRange,
  channel?: SalesChannel,
): Promise<{ revenue: number; orders: number; aov: number; byStatus: Record<OrderStatus, number> }> {
  const where = and(
    // DECISION (M8 browser check): bind ISO strings, not Date objects - postgres-js rejects a Date bound inside a raw `sql` fragment.
    sql`${orders.placedAt} >= ${range.from}::timestamptz`,
    sql`${orders.placedAt} < ${range.to}::timestamptz`,
    channel === undefined ? undefined : eq(orders.channel, channel),
  );
  const rows = await db.select({ status: orders.status, grandTotal: orders.grandTotal }).from(orders).where(where);
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  let revenue = 0;
  let paidCount = 0;
  for (const r of rows) {
    byStatus[r.status] += 1;
    if (r.status === "paid" || r.status === "processing" || r.status === "shipped" || r.status === "delivered") {
      revenue += Number(r.grandTotal);
      paidCount += 1;
    }
  }
  // `orders` counts sales (paid → delivered); cancelled/refunded/expired rows only appear in byStatus.
  return { revenue, orders: paidCount, aov: paidCount === 0 ? 0 : Math.round(revenue / paidCount), byStatus };
}
