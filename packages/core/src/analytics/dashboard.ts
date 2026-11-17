import { type Db, sql } from "@namilux/db";
import type { UaClass } from "../constants";
import type { SalesChannel } from "../channel";
import type { DashboardData, DashboardDay, DashboardRange, DateRange } from "../types";
import { jobs } from "../jobs";
import { salesStats } from "../orders/repo";
import { listReturns } from "../orders/returns";
import { smsLog } from "../sms-log";
import { dayKey } from "./record";
import { concierge } from "../requests/concierge";
import { questions } from "../reviews/questions";

const DAY = 86_400_000;

function toDateRange(range: DashboardRange, now: Date): DateRange {
  if (typeof range === "object") return { from: `${range.from}T00:00:00.000Z`, to: `${range.to}T23:59:59.999Z` };
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
  const from = range === "today" ? new Date(new Date(now).setHours(0, 0, 0, 0)) : new Date(now.getTime() - days * DAY);
  return { from: from.toISOString(), to: now.toISOString() };
}

async function rangeCount(db: Db, range: DashboardRange, now: Date, extra: string): Promise<number> {
  const r = toDateRange(range, now);
  const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from events where ts >= ${r.from} and ts <= ${r.to} and ${sql.raw(extra)}`);
  const list = rows;
  return Number(list[0]?.n ?? 0);
}

/** The period of the same length that ends where `r` begins - what a KPI's delta compares against. */
function previousOf(r: DateRange): DateRange {
  const from = Date.parse(r.from);
  const to = Date.parse(r.to);
  return { from: new Date(from - (to - from)).toISOString(), to: new Date(from).toISOString() };
}

const PAID = sql.raw("('paid','processing','shipped','delivered')");
const SERIES_DAYS = 30;
/** Tehran has kept +03:30 all year since 2022; the chart's day boundaries follow it. */
const TEHRAN_OFFSET_MS = 3.5 * 3_600_000;

/** Paid sales per Tehran calendar day and storefront over the last 30 days, zero-filled, oldest first. */
async function salesSeries(db: Db, now: Date, channel: SalesChannel | undefined): Promise<DashboardDay[]> {
  const from = new Date(now.getTime() - SERIES_DAYS * DAY).toISOString();
  const rows = await db.execute<{ day: string; channel: SalesChannel; revenue: string | number; orders: number }>(sql`
    select to_char((placed_at at time zone 'Asia/Tehran')::date, 'YYYY-MM-DD') as day, channel,
           coalesce(sum(grand_total) filter (where status in ${PAID}), 0)::bigint as revenue,
           (count(*) filter (where status in ${PAID}))::int as orders
    from orders where placed_at >= ${from}::timestamptz and placed_at <= ${now.toISOString()}::timestamptz
    ${channel === undefined ? sql`` : sql`and channel = ${channel}`}
    group by 1, 2`);
  const byDay = new Map<string, DashboardDay>();
  for (let i = SERIES_DAYS - 1; i >= 0; i -= 1) {
    const day = new Date(now.getTime() - i * DAY + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
    byDay.set(day, { day, revenue: { main: 0, instalments: 0 }, orders: 0 });
  }
  for (const r of rows) {
    const d = byDay.get(r.day);
    if (d === undefined) continue;
    d.revenue[r.channel] += Number(r.revenue);
    d.orders += Number(r.orders);
  }
  return [...byDay.values()];
}

/**
 * The dashboard's figures. `channel` confines every sales, order and stock figure to one storefront
 * (a staff member whose role is scoped to it); left out, the owner sees both sites and their split.
 */
export async function dashboard(db: Db, range: DashboardRange, ctx: { now: Date; smsDailyBudget: number; channel?: SalesChannel }): Promise<DashboardData> {
  const now = ctx.now;
  const channel = ctx.channel;
  const current = toDateRange(range, now);
  const [today, d7, d30, cur, prev, split, series] = await Promise.all([
    salesStats(db, toDateRange("today", now), channel),
    salesStats(db, toDateRange("7d", now), channel),
    salesStats(db, toDateRange("30d", now), channel),
    salesStats(db, current, channel),
    salesStats(db, previousOf(current), channel),
    channel === undefined ? Promise.all([salesStats(db, current, "main"), salesStats(db, current, "instalments")]) : Promise.resolve(null),
    salesSeries(db, now, channel),
  ]);

  const lowStockRows = await db.execute<{ id: number; name: string; available: number }>(sql`
    select p.id, p.display_name as name, (p.stock_qty - coalesce((select sum(qty) from inventory_reservations r where r.product_id = p.id and r.released_at is null and r.consumed_at is null), 0))::int as available
    from products p where p.status = 'active' and p.stock_policy = 'track'
    ${channel === "instalments" ? sql`and p.instalment_eligible` : sql``}
    and (p.stock_qty - coalesce((select sum(qty) from inventory_reservations r where r.product_id = p.id and r.released_at is null and r.consumed_at is null), 0)) <= p.low_stock_threshold
    order by available asc limit 10`);
  const lowList = lowStockRows;

  const topRows = await db.execute<{ id: number; name: string; qty: number; revenue: number }>(sql`
    select oi.product_id as id, max(oi.name) as name, sum(oi.qty)::int as qty, sum(oi.line_total)::bigint as revenue
    from order_items oi join orders o on o.id = oi.order_id
    where o.status in ('paid','processing','shipped','delivered') and o.paid_at >= ${toDateRange("30d", now).from}
    ${channel === undefined ? sql`` : sql`and o.channel = ${channel}`}
    group by oi.product_id order by qty desc limit 10`);
  const topList = topRows;

  // The inbox is not per storefront, so a confined reader gets zeros (its role has no inbox either).
  const confined = channel !== undefined;
  const [conciergeCounts, questionCounts, jobStats] = await Promise.all([
    confined ? Promise.resolve({ pending: 0 }) : concierge.counts(db),
    confined ? Promise.resolve({ pending: 0 }) : questions.counts(db),
    jobs.stats(db),
  ]);
  const reviewsPending = confined ? { n: 0 } : ((await db.execute<{ n: number }>(sql`select count(*)::int as n from reviews where status = 'pending'`))[0] ?? { n: 0 });
  const contactPending = confined ? { n: 0 } : ((await db.execute<{ n: number }>(sql`select count(*)::int as n from questions where kind = 'contact' and status = 'pending'`))[0] ?? { n: 0 });
  // Conversion divides purchases by sessions, and sessions are not per storefront: none when confined.
  const sessions30 = confined ? 0 : await rangeCount(db, "30d", now, "true and session_hash <> ''");
  const purchases30 = d30.orders;

  const [spend, heartbeatAt, returnsPending] = await Promise.all([
    smsLog.spend(db, dayKey(now)),
    jobs.lastHeartbeat(db),
    listReturns(db, { status: "pending", page: 1, ...(channel === undefined ? {} : { channel }) })
      .then((r) => r.total)
      .catch(() => 0),
  ]);
  const own = { revenue: cur.revenue, orders: cur.orders };
  const none = { revenue: 0, orders: 0 };
  return {
    range,
    channel: channel ?? null,
    revenue: { today: today.revenue, d7: d7.revenue, d30: d30.revenue },
    period: { revenue: cur.revenue, orders: cur.orders, aov: cur.aov, previous: { revenue: prev.revenue, orders: prev.orders, aov: prev.aov } },
    byChannel:
      split === null
        ? { main: channel === "main" ? own : none, instalments: channel === "instalments" ? own : none }
        : { main: { revenue: split[0].revenue, orders: split[0].orders }, instalments: { revenue: split[1].revenue, orders: split[1].orders } },
    series,
    ordersByStatus: d30.byStatus,
    aov: d30.aov,
    conversion: sessions30 === 0 ? 0 : Math.round((purchases30 / sessions30) * 1000) / 1000,
    topProducts: topList.map((t) => ({ productId: t.id, displayName: t.name, qty: Number(t.qty), revenue: Number(t.revenue) })),
    lowStock: lowList.map((l) => ({ productId: l.id, displayName: l.name, available: Number(l.available) })),
    inbox: { concierge: conciergeCounts.pending, questions: questionCounts.pending, reviews: Number(reviewsPending?.n ?? 0), returns: returnsPending, contact: Number(contactPending?.n ?? 0) },
    otp: { sendsToday: spend.otpSends, smsSpendToday: spend.costToman, budget: ctx.smsDailyBudget },
    jobs: { failed: jobStats.failed ?? 0, dead: jobStats.dead ?? 0, queued: jobStats.queued ?? 0 },
    // DECISION (M8): the backup handler only alerts on failure and keeps no last-success row, so the
    // dashboard cannot know the last backup time - it stays null (rendered « - ») until the spec adds a status write.
    lastBackupAt: null,
    workerHeartbeatAt: heartbeatAt,
    revalidateQueue: jobStats.queued ?? 0,
  };
}

export async function funnel(db: Db, range: DashboardRange): Promise<{ step: string; count: number; rate: number }[]> {
  const now = new Date();
  const steps: { step: string; where: string }[] = [
    { step: "pv", where: "type = 'pv'" },
    { step: "pdp", where: "type = 'pv' and path like '/product/%'" },
    { step: "atc", where: "type = 'atc'" },
    { step: "checkout", where: "type = 'checkout_step'" },
    { step: "purchase", where: "type = 'purchase'" },
  ];
  const counts = await Promise.all(steps.map((s) => rangeCount(db, range, now, s.where)));
  const first = counts[0] ?? 0;
  return steps.map((s, i) => ({ step: s.step, count: counts[i] ?? 0, rate: first === 0 ? 0 : Math.round(((counts[i] ?? 0) / first) * 1000) / 1000 }));
}

async function grouped(db: Db, range: DashboardRange, expr: string, where: string): Promise<{ key: string; count: number }[]> {
  const r = toDateRange(range, new Date());
  const rows = await db.execute<{ key: string; count: number }>(sql`select ${sql.raw(expr)} as key, count(*)::int as count from events where ts >= ${r.from} and ts <= ${r.to} and ${sql.raw(where)} group by key order by count desc limit 20`);
  return [...rows];
}

export async function topPages(db: Db, range: DashboardRange): Promise<{ path: string; views: number }[]> {
  return (await grouped(db, range, "path", "type = 'pv'")).map((g) => ({ path: g.key, views: Number(g.count) }));
}

export async function zeroResultSearches(db: Db, range: DashboardRange): Promise<{ term: string; count: number }[]> {
  return (await grouped(db, range, "props_json->>'term'", "type = 'search' and (props_json->>'zero') = 'true'")).map((g) => ({ term: g.key ?? "", count: Number(g.count) }));
}

export async function sources(db: Db, range: DashboardRange): Promise<{ source: string; sessions: number; purchases: number }[]> {
  return (await grouped(db, range, "coalesce(ref, 'direct')", "true")).map((g) => ({ source: g.key ?? "direct", sessions: Number(g.count), purchases: 0 }));
}

export async function uaClasses(db: Db, range: DashboardRange): Promise<Record<UaClass, number>> {
  const rows = await grouped(db, range, "ua_class", "true");
  const out: Record<UaClass, number> = { mobile: 0, desktop: 0, inapp: 0, pwa: 0 };
  for (const r of rows) if (r.key in out) out[r.key as UaClass] = Number(r.count);
  return out;
}
