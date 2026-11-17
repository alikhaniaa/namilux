import { type Db, and, asc, customers, eq, inArray, sql } from "@namilux/db";
import type { SmsSegmentInput } from "../validation/marketing";

export type SegmentInput = SmsSegmentInput;

export const CAMPAIGN_MAX_RECIPIENTS = 20_000;

const REACHABLE_STATUSES = ["paid", "processing", "shipped", "delivered"] as const;

export async function resolveSegment(db: Db, seg: SegmentInput, now = new Date()): Promise<{ phones: string[]; total: number }> {
  const conds = [eq(customers.marketingOptIn, true), eq(customers.isBlocked, false)];
  if (seg.tiers !== undefined && seg.tiers.length > 0) conds.push(inArray(customers.tier, seg.tiers));

  const since = seg.lastOrderWithinDays === undefined ? null : new Date(now.getTime() - seg.lastOrderWithinDays * 86_400_000);
  const brandIds = seg.brandIds ?? [];
  if (since !== null || brandIds.length > 0) {
    // One EXISTS over the customer's reachable orders; the brand condition joins the order lines.
    const statusList = sql.join(
      REACHABLE_STATUSES.map((s) => sql`${s}`),
      sql`, `,
    );
    const brandList = sql.join(
      brandIds.map((id) => sql`${id}`),
      sql`, `,
    );
    conds.push(sql`exists (
      select 1 from orders o
      where o.customer_id = ${customers.id}
        and o.status in (${statusList})
        ${since === null ? sql`` : sql`and o.placed_at >= ${since}`}
        ${
          brandIds.length === 0
            ? sql``
            : sql`and exists (
                select 1 from order_items oi join products p on p.id = oi.product_id
                where oi.order_id = o.id and p.brand_id in (${brandList}))`
        }
    )`);
  }

  const rows = await db
    .select({ phone: customers.phone })
    .from(customers)
    .where(and(...conds))
    .orderBy(asc(customers.id))
    .limit(CAMPAIGN_MAX_RECIPIENTS);
  const phones = [...new Set(rows.map((r) => r.phone))];
  return { phones, total: phones.length };
}
