import {
  type Db,
  and,
  asc,
  collectionProducts,
  desc,
  eq,
  inArray,
  inventoryMovements,
  inventoryReservations,
  isNull,
  media,
  orders,
  payments,
  productCategories,
  productImages,
  products,
  shippingMethods,
  sql,
} from "@namilux/db";
import type { MovementReason } from "../constants";
import { appError } from "../errors";
import type { QuoteProduct } from "../pricing/quote";
import type { ShippingMethod } from "../pricing/shipping";
import type { Actor } from "../types";

export type ProductStockRow = {
  id: number;
  stockPolicy: "track" | "untracked";
  stockQty: number;
  allowBackorder: boolean;
  maxPerOrder: number;
  lowStockThreshold: number;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  price: number;
};

export type ReservationRow = {
  id: string;
  productId: number;
  orderId: string;
  qty: number;
  expiresAt: Date;
  releasedAt: Date | null;
  consumedAt: Date | null;
};

export type MovementInput = {
  productId: number;
  delta: number;
  reason: MovementReason;
  orderId?: string | null;
  actor: Actor;
  note?: string;
};

export async function loadProductsForQuote(
  db: Db,
  ids: number[],
  opts: { lock: "none" | "share" | "update" },
): Promise<QuoteProduct[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort((a, b) => a - b); // sorted + deduped to avoid deadlocks

  const base = db
    .select({
      id: products.id,
      name: products.name,
      displayName: products.displayName,
      slug: products.slug,
      price: products.price,
      compareAt: products.compareAtPrice,
      // The instalment storefront quotes `resolveInstalmentPrice(...)` instead of `price`, so both
      // columns travel with the row the quote is priced from.
      instalmentPrice: products.instalmentPrice,
      instalmentPriceManual: products.instalmentPriceManual,
      // The per-product instalment switch: the instalment quote drops a product that has it off, and
      // placeOrder re-checks it on these same (locked) rows.
      instalmentEligible: products.instalmentEligible,
      status: products.status,
      visibility: products.visibility,
      stockPolicy: products.stockPolicy,
      stockQty: products.stockQty,
      allowBackorder: products.allowBackorder,
      maxPerOrder: products.maxPerOrder,
      lowStockThreshold: products.lowStockThreshold,
      brandId: products.brandId,
      sku: products.sku,
      modelCode: products.modelCode,
      colorName: products.colorName,
      warrantyMonths: products.warrantyMonths,
    })
    .from(products)
    .where(inArray(products.id, sorted))
    .orderBy(asc(products.id));
  const rows = opts.lock === "update" ? await base.for("update") : opts.lock === "share" ? await base.for("share") : await base;

  // Primary image (role 'primary' first, else lowest sort), category ids, collection ids, reserved qty.
  const [imgs, cats, cols, reserved] = await Promise.all([
    db
      .select({ productId: productImages.productId, storageKey: media.storageKey, role: productImages.role, sort: productImages.sort })
      .from(productImages)
      .innerJoin(media, eq(productImages.mediaId, media.id))
      .where(inArray(productImages.productId, sorted))
      .orderBy(asc(productImages.productId), asc(productImages.sort)),
    db
      .select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(inArray(productCategories.productId, sorted)),
    db
      .select({ productId: collectionProducts.productId, collectionId: collectionProducts.collectionId })
      .from(collectionProducts)
      .where(inArray(collectionProducts.productId, sorted)),
    db
      .select({ productId: inventoryReservations.productId, qty: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::int` })
      .from(inventoryReservations)
      .where(
        and(
          inArray(inventoryReservations.productId, sorted),
          isNull(inventoryReservations.releasedAt),
          isNull(inventoryReservations.consumedAt),
        ),
      )
      .groupBy(inventoryReservations.productId),
  ]);

  const imageOf = new Map<number, string>();
  for (const im of imgs) {
    if (im.role === "primary") imageOf.set(im.productId, im.storageKey);
    else if (!imageOf.has(im.productId)) imageOf.set(im.productId, im.storageKey);
  }
  const catOf = new Map<number, number[]>();
  for (const c of cats) catOf.set(c.productId, [...(catOf.get(c.productId) ?? []), c.categoryId]);
  const colOf = new Map<number, number[]>();
  for (const c of cols) colOf.set(c.productId, [...(colOf.get(c.productId) ?? []), c.collectionId]);
  const reservedOf = new Map(reserved.map((r) => [r.productId, r.qty]));

  const byId = new Map<number, QuoteProduct>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      displayName: r.displayName,
      slug: r.slug,
      price: r.price,
      compareAt: r.compareAt,
      instalmentPrice: r.instalmentPrice,
      instalmentPriceManual: r.instalmentPriceManual,
      instalmentEligible: r.instalmentEligible,
      status: r.status,
      visibility: r.visibility,
      stockPolicy: r.stockPolicy,
      stockQty: r.stockQty,
      reserved: reservedOf.get(r.id) ?? 0,
      allowBackorder: r.allowBackorder,
      maxPerOrder: r.maxPerOrder,
      lowStockThreshold: r.lowStockThreshold,
      brandId: r.brandId,
      categoryIds: catOf.get(r.id) ?? [],
      collectionIds: colOf.get(r.id) ?? [],
      imageKey: imageOf.get(r.id) ?? null,
      sku: r.sku,
      modelCode: r.modelCode,
      colorName: r.colorName,
      warrantyMonths: r.warrantyMonths,
    });
  }
  // Return in the caller's order, omitting unknown ids.
  return ids.map((id) => byId.get(id)).filter((p): p is QuoteProduct => p !== undefined);
}

/**
 * The instalment switch of each product, and nothing else - for the paths that must re-check it
 * without pricing a basket (retryPayment, the checkout eligibility endpoint). An id that no longer
 * resolves is simply absent: those paths already refuse a gone product for their own reasons.
 */
export async function loadInstalmentEligibility(db: Db, ids: number[]): Promise<{ id: number; instalmentEligible: boolean }[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  return db
    .select({ id: products.id, instalmentEligible: products.instalmentEligible })
    .from(products)
    .where(inArray(products.id, sorted))
    .orderBy(asc(products.id));
}

export async function listActiveShippingMethods(db: Db): Promise<ShippingMethod[]> {
  const rows = await db.select().from(shippingMethods).where(eq(shippingMethods.isActive, true)).orderBy(asc(shippingMethods.sort));
  return rows.map((r) => ({
    id: r.id,
    key: r.key as ShippingMethod["key"],
    name: r.name,
    description: r.description ?? "",
    kind: r.kind,
    rate: r.rateJson,
    provinces: (r.provinces as ShippingMethod["provinces"]) ?? null,
    etaMinDays: r.etaMinDays,
    etaMaxDays: r.etaMaxDays,
    isActive: r.isActive,
    sort: r.sort,
  }));
}

export async function lockProductForStock(db: Db, productId: number): Promise<ProductStockRow | null> {
  const rows = await db
    .select({
      id: products.id,
      stockPolicy: products.stockPolicy,
      stockQty: products.stockQty,
      allowBackorder: products.allowBackorder,
      maxPerOrder: products.maxPerOrder,
      lowStockThreshold: products.lowStockThreshold,
      status: products.status,
      visibility: products.visibility,
      price: products.price,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

/** Time makes a hold eligible for expiry; only explicit release/consumption frees its stock. */
export async function activeReservedQty(db: Db, productId: number): Promise<number> {
  const rows = await db
    .select({ qty: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::int` })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.productId, productId),
        isNull(inventoryReservations.releasedAt),
        isNull(inventoryReservations.consumedAt),
      ),
    );
  return rows[0]?.qty ?? 0;
}

export async function insertReservation(
  db: Db,
  r: { id: string; productId: number; orderId: string; qty: number; expiresAt: Date },
): Promise<void> {
  await db.insert(inventoryReservations).values({
    id: r.id,
    productId: r.productId,
    orderId: r.orderId,
    qty: r.qty,
    expiresAt: r.expiresAt,
  });
}

export async function listOrderReservations(
  db: Db,
  orderId: string,
  opts?: { lock?: boolean },
): Promise<ReservationRow[]> {
  const base = db
    .select({
      id: inventoryReservations.id,
      productId: inventoryReservations.productId,
      orderId: inventoryReservations.orderId,
      qty: inventoryReservations.qty,
      expiresAt: inventoryReservations.expiresAt,
      releasedAt: inventoryReservations.releasedAt,
      consumedAt: inventoryReservations.consumedAt,
    })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.orderId, orderId),
        isNull(inventoryReservations.releasedAt),
        isNull(inventoryReservations.consumedAt),
      ),
    )
    .orderBy(asc(inventoryReservations.productId));
  return opts?.lock === true ? await base.for("update") : await base;
}

export async function markReleased(db: Db, orderId: string, now: Date): Promise<number> {
  const rows = await db
    .update(inventoryReservations)
    .set({ releasedAt: now })
    .where(
      and(
        eq(inventoryReservations.orderId, orderId),
        isNull(inventoryReservations.releasedAt),
        isNull(inventoryReservations.consumedAt),
      ),
    )
    .returning({ id: inventoryReservations.id });
  return rows.length;
}

export async function markConsumed(db: Db, reservationId: string, now: Date): Promise<void> {
  await db
    .update(inventoryReservations)
    .set({ consumedAt: now })
    .where(and(eq(inventoryReservations.id, reservationId), isNull(inventoryReservations.consumedAt)));
}

export type PendingReservationExpiry = (tx: Db, orderId: string) => Promise<void>;

export async function releaseExpired(db: Db, now: Date, graceMs: number, expirePending?: PendingReservationExpiry): Promise<{ orderIds: string[] }> {
  const nowSql = sql`${now.toISOString()}::timestamptz`;
  const graceSql = sql`${now.toISOString()}::timestamptz - (${Math.floor(graceMs / 1000)} * interval '1 second')`;
  const due = and(
    sql`${inventoryReservations.expiresAt} <= ${nowSql}`,
    isNull(inventoryReservations.releasedAt),
    isNull(inventoryReservations.consumedAt),
    sql`not exists (select 1 from ${payments} p where p.order_id = ${inventoryReservations.orderId} and p.status = 'redirected' and (p.created_at > ${graceSql} or p.verified_at is not null))`,
  );
  const candidates = await db.selectDistinct({ orderId: inventoryReservations.orderId }).from(inventoryReservations)
    .where(due).orderBy(asc(inventoryReservations.orderId));
  const orderIds: string[] = [];
  for (const candidate of candidates) {
    const released = await db.transaction(async (tx) => {
      // Callback, retry and expiry all acquire order -> reservations/inventory -> customer.
      // Re-read eligibility under the lock: a payment or a renewed reservation may have won.
      // A callback can wait on its gateway for minutes; the next sweep handles busy orders.
      const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, candidate.orderId)).for("update", { skipLocked: true });
      if (order === undefined || !["draft", "pending_payment", "failed", "expired", "cancelled"].includes(order.status)) return false;
      // Releasing a live order without also ending it leaves a window in which a callback can
      // mark it paid after consumeReservations finds no rows. Require an atomic lifecycle action.
      if (order.status === "pending_payment" && expirePending === undefined) return false;
      const rows = await tx.update(inventoryReservations).set({ releasedAt: now })
        .where(and(eq(inventoryReservations.orderId, candidate.orderId), due)).returning({ id: inventoryReservations.id });
      if (rows.length === 0) return false;
      if (order.status === "pending_payment" && expirePending !== undefined) {
        await expirePending(tx, candidate.orderId);
        const [ended] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, candidate.orderId));
        if (ended?.status === "pending_payment") throw appError("INTERNAL", { details: "reservation expiry must end the pending order" });
      }
      return true;
    });
    if (released) orderIds.push(candidate.orderId);
  }
  return { orderIds };
}

export async function insertMovement(db: Db, m: MovementInput): Promise<{ id: number }> {
  const rows = await db
    .insert(inventoryMovements)
    .values({
      productId: m.productId,
      delta: m.delta,
      reason: m.reason,
      orderId: m.orderId ?? null,
      actorType: m.actor.type,
      actorId: m.actor.id,
      note: m.note ?? null,
    })
    .returning({ id: inventoryMovements.id });
  const row = rows[0];
  if (row === undefined) throw appError("INTERNAL", { details: "insertMovement returned no row" });
  return { id: row.id };
}

export async function applyStockDelta(db: Db, productId: number, delta: number): Promise<{ stockQty: number }> {
  const rows = await db
    .update(products)
    .set({ stockQty: sql`${products.stockQty} + ${delta}` })
    .where(eq(products.id, productId))
    .returning({ stockQty: products.stockQty });
  const row = rows[0];
  if (row === undefined) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد" });
  return { stockQty: row.stockQty };
}

export async function sumMovements(db: Db, productId: number): Promise<number> {
  const rows = await db
    .select({ sum: sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.productId, productId));
  return rows[0]?.sum ?? 0;
}

export async function listMovements(
  db: Db,
  productId: number,
  page: number,
  pageSize = 50,
): Promise<{ items: (MovementInput & { id: number; createdAt: string })[]; total: number }> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, productId))
      .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(eq(inventoryMovements.productId, productId)),
  ]);
  const items = rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    delta: r.delta,
    reason: r.reason,
    orderId: r.orderId,
    actor: { type: r.actorType, id: r.actorId } satisfies Actor,
    createdAt: r.createdAt.toISOString(),
    ...(r.note !== null ? { note: r.note } : {}),
  }));
  return { items, total: counted[0]?.n ?? 0 };
}

export async function stockDriftReport(
  db: Db,
): Promise<{ productId: number; stockQty: number; movementSum: number }[]> {
  // Products whose cached stock_qty disagrees with the ledger sum. Uses the query builder's
  // outer join (leftJoin) rather than a raw "left …" SQL string, which the CSS-direction lint forbids.
  const movementSum = sql<number>`coalesce(sum(${inventoryMovements.delta}), 0)::int`;
  return db
    .select({ productId: products.id, stockQty: products.stockQty, movementSum })
    .from(products)
    .leftJoin(inventoryMovements, eq(inventoryMovements.productId, products.id))
    .where(eq(products.stockPolicy, "track"))
    .groupBy(products.id, products.stockQty)
    .having(sql`${products.stockQty} <> coalesce(sum(${inventoryMovements.delta}), 0)`)
    .orderBy(asc(products.id));
}
