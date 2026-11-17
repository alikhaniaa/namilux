import { type Db, and, asc, customers, desc, eq, inArray, orderItems, orders, products, reviews as reviewsTable, sql } from "@namilux/db";
import { appError } from "../errors";
import { ulid } from "../ids";
import { audit } from "../audit";
import type { Actor, Paged, Review, ReviewSummary } from "../types";
import type { ReviewInput } from "../validation/reviews";

export const MIN_REVIEWS_FOR_AGGREGATE = 3;

async function recomputeAggregate(db: Db, productId: number): Promise<ReviewSummary> {
  const rows = await db
    .select({ rating: reviewsTable.rating, n: sql<number>`count(*)::int` })
    .from(reviewsTable)
    .where(and(eq(reviewsTable.productId, productId), eq(reviewsTable.status, "approved")))
    .groupBy(reviewsTable.rating);
  const histogram: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const stars = r.rating as 1 | 2 | 3 | 4 | 5;
    histogram[stars] = Number(r.n);
    count += Number(r.n);
    sum += stars * Number(r.n);
  }
  const avg = count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
  await db.execute(sql`update products set rating_avg = ${avg}, rating_count = ${count} where id = ${productId}`);
  return { avg, count, histogram };
}

/** «سارا م.» - first name plus the initial of the last name; a nameless customer reads as the shop's own guest. */
function reviewerDisplayName(first: string | null, last: string | null): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f === "" && l === "") return "مشتری نامی‌لوکس";
  if (l === "") return f;
  return f === "" ? l : `${f} ${l.slice(0, 1)}.`;
}

function mapReview(r: typeof reviewsTable.$inferSelect, first: string | null, last: string | null): Review {
  return {
    id: r.id,
    productId: r.productId,
    customerId: r.customerId,
    customerDisplayName: reviewerDisplayName(first, last),
    orderId: r.orderId,
    rating: r.rating as 1 | 2 | 3 | 4 | 5,
    title: r.title ?? "",
    body: r.body,
    pros: r.pros ?? [],
    cons: r.cons ?? [],
    isVerifiedPurchase: r.isVerifiedPurchase,
    status: r.status,
    adminReply: r.adminReply,
    repliedAt: r.repliedAt === null ? null : r.repliedAt.toISOString(),
    helpfulCount: r.helpfulCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export type ReviewSort = "newest" | "helpful" | "rating_desc" | "rating_asc";
export const REVIEWS_PAGE_SIZE = 10;

export const reviews = {
  async submit(db: Db, customerId: string, input: ReviewInput & { productId: number }): Promise<{ id: string; status: "pending" }> {
    const existing = await db
      .select({ id: reviewsTable.id })
      .from(reviewsTable)
      .where(and(eq(reviewsTable.productId, input.productId), eq(reviewsTable.customerId, customerId)))
      .limit(1);
    if (existing[0] !== undefined) throw appError("CONFLICT", { fa: "قبلاً نظر داده‌اید" });

    // Verified purchase: a paid|processing|shipped|delivered order of this product by this customer.
    const purchased = await db
      .select({ orderId: orders.id })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orderItems.productId, input.productId), eq(orders.customerId, customerId), inArray(orders.status, ["paid", "processing", "shipped", "delivered"])))
      .limit(1);
    const orderId = purchased[0]?.orderId ?? null;

    const id = ulid();
    await db.insert(reviewsTable).values({
      id,
      productId: input.productId,
      customerId,
      orderId,
      rating: input.rating,
      title: input.title,
      body: input.body,
      pros: input.pros ?? null,
      cons: input.cons ?? null,
      isVerifiedPurchase: orderId !== null,
      status: "pending",
    });
    return { id, status: "pending" };
  },

  async moderate(db: Db, id: string, status: "approved" | "rejected", reply: string | null, actor: Actor): Promise<{ productId: number }> {
    const rows = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) throw appError("NOT_FOUND", { fa: "نظر پیدا نشد" });
    await db
      .update(reviewsTable)
      .set({ status, adminReply: reply, repliedAt: reply === null ? null : new Date() })
      .where(eq(reviewsTable.id, id));
    await recomputeAggregate(db, row.productId);
    await audit.log(db, actor, "review.moderate", "reviews", id, { status: row.status }, { status, hasReply: reply !== null });
    return { productId: row.productId };
  },

  /** the spec: blocking a customer rejects every review they wrote (aggregates refreshed per product). */
  async hideAllFor(db: Db, customerId: string, actor: Actor): Promise<{ hidden: number }> {
    const rows = await db
      .update(reviewsTable)
      .set({ status: "rejected" })
      .where(and(eq(reviewsTable.customerId, customerId), sql`${reviewsTable.status} <> 'rejected'`))
      .returning({ id: reviewsTable.id, productId: reviewsTable.productId });
    for (const productId of new Set(rows.map((r) => r.productId))) await recomputeAggregate(db, productId);
    if (rows.length > 0) await audit.log(db, actor, "review.hide_all", "customers", customerId, null, { hidden: rows.length });
    return { hidden: rows.length };
  },

  async summary(db: Db, productId: number): Promise<ReviewSummary> {
    const rows = await db
      .select({ rating: reviewsTable.rating, n: sql<number>`count(*)::int` })
      .from(reviewsTable)
      .where(and(eq(reviewsTable.productId, productId), eq(reviewsTable.status, "approved")))
      .groupBy(reviewsTable.rating);
    const histogram: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let count = 0;
    let sum = 0;
    for (const r of rows) {
      const stars = r.rating as 1 | 2 | 3 | 4 | 5;
      histogram[stars] = Number(r.n);
      count += Number(r.n);
      sum += stars * Number(r.n);
    }
    return { avg: count === 0 ? 0 : Math.round((sum / count) * 10) / 10, count, histogram };
  },

  async vote(db: Db, reviewId: string, voterKey: string): Promise<{ helpful: number }> {
    void voterKey; // no review_votes table → not deduped per voter (see DECISION)
    const rows = await db
      .update(reviewsTable)
      .set({ helpfulCount: sql`${reviewsTable.helpfulCount} + 1` })
      .where(eq(reviewsTable.id, reviewId))
      .returning({ helpful: reviewsTable.helpfulCount });
    return { helpful: rows[0]?.helpful ?? 0 };
  },

  /**
   * Storefront list: approved rows only, joined to the customer for the display name. Sorts per
   * validation/reviews.reviewListQuerySchema; ties broken by recency so paging is stable.
   */
  async listForProduct(db: Db, productId: number, q: { page?: number; sort?: ReviewSort } = {}): Promise<Paged<Review>> {
    const page = Math.max(1, q.page ?? 1);
    const sort = q.sort ?? "newest";
    const order =
      sort === "helpful"
        ? [desc(reviewsTable.helpfulCount), desc(reviewsTable.createdAt)]
        : sort === "rating_desc"
          ? [desc(reviewsTable.rating), desc(reviewsTable.createdAt)]
          : sort === "rating_asc"
            ? [asc(reviewsTable.rating), desc(reviewsTable.createdAt)]
            : [desc(reviewsTable.createdAt)];
    const where = and(eq(reviewsTable.productId, productId), eq(reviewsTable.status, "approved"));
    const [rows, totalRows] = await Promise.all([
      db
        .select({ r: reviewsTable, firstName: customers.firstName, lastName: customers.lastName })
        .from(reviewsTable)
        .innerJoin(customers, eq(customers.id, reviewsTable.customerId))
        .where(where)
        .orderBy(...order)
        .limit(REVIEWS_PAGE_SIZE)
        .offset((page - 1) * REVIEWS_PAGE_SIZE),
      db.select({ n: sql<number>`count(*)::int` }).from(reviewsTable).where(where),
    ]);
    return {
      items: rows.map((x) => mapReview(x.r, x.firstName, x.lastName)),
      total: Number(totalRows[0]?.n ?? 0),
      page,
      pageSize: REVIEWS_PAGE_SIZE,
    };
  },

  /** Admin customer screen: every review the customer wrote, newest first (any status). */
  async listForCustomer(db: Db, customerId: string): Promise<Review[]> {
    const rows = await db
      .select({ r: reviewsTable, firstName: customers.firstName, lastName: customers.lastName })
      .from(reviewsTable)
      .innerJoin(customers, eq(customers.id, reviewsTable.customerId))
      .where(eq(reviewsTable.customerId, customerId))
      .orderBy(desc(reviewsTable.createdAt))
      .limit(100);
    return rows.map((x) => mapReview(x.r, x.firstName, x.lastName));
  },

  async listAdmin(
    db: Db,
    q: { status?: "pending" | "approved" | "rejected"; productId?: number; page?: number },
  ): Promise<Paged<Review & { productName: string }>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = 50;
    const conds = [];
    if (q.status !== undefined) conds.push(eq(reviewsTable.status, q.status));
    if (q.productId !== undefined) conds.push(eq(reviewsTable.productId, q.productId));
    const where = conds.length === 0 ? undefined : and(...conds);
    const [rows, totalRows] = await Promise.all([
      db
        .select({ r: reviewsTable, firstName: customers.firstName, lastName: customers.lastName, productName: products.displayName })
        .from(reviewsTable)
        .innerJoin(customers, eq(customers.id, reviewsTable.customerId))
        .innerJoin(products, eq(products.id, reviewsTable.productId))
        .where(where)
        .orderBy(desc(reviewsTable.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(reviewsTable).where(where),
    ]);
    return { items: rows.map((x) => ({ ...mapReview(x.r, x.firstName, x.lastName), productName: x.productName })), total: Number(totalRows[0]?.n ?? 0), page, pageSize };
  },
};

export function aggregateForJsonLd(s: ReviewSummary): { ratingValue: number; reviewCount: number } | null {
  if (s.count < MIN_REVIEWS_FOR_AGGREGATE) return null;
  return { ratingValue: s.avg, reviewCount: s.count };
}
