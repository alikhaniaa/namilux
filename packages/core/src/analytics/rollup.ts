import { type Db, sql } from "@namilux/db";

export const METRICS = ["sessions", "pageviews", "pdp_views", "atc", "checkout_step_1", "checkout_step_2", "checkout_step_3", "purchases", "revenue", "aov", "conversion", "search_count", "search_zero", "installs", "concierge_requests", "top_pages", "top_products", "sources", "ua_class", "otp_sent", "sms_sent"] as const;

/**
 * Idempotent daily rollup: delete the day's metric rows, then aggregate that day's events (Asia/Tehran)
 * into metrics_daily (day, metric, dim, value). One transaction.
 * DECISION (M8 completion): every contract metric is materialised - scalar counts from `events`,
 * purchases/revenue/aov/conversion from paid orders (rules), and the dimensioned top-20 breakdowns
 * (top_pages/top_products/sources/ua_class) - so the analytics pages read one table for past days;
 * dashboard.ts still answers the live ranges straight from `events`.
 */
export async function rollupDay(db: Db, day: string): Promise<{ metrics: number }> {
  let written = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from metrics_daily where day = ${day}`);
    const bounds = sql`(ts at time zone 'Asia/Tehran')::date = ${day}`;
    // rules: revenue/purchases come from orders (paid_at in the Tehran day), never from beacons.
    const paidBounds = sql`o.status in ('paid','processing','shipped','delivered') and (o.paid_at at time zone 'Asia/Tehran')::date = ${day}`;
    // Delivery logs cover OTP and historical sends even when best-effort analytics was unavailable.
    // Count successful sends, not queued recipients or server-event duplicates.
    const counts = await tx.execute<{ metric: string; value: number }>(sql`
      select 'pageviews' as metric, count(*) filter (where type = 'pv')::int as value from events where ${bounds}
      union all select 'pdp_views', count(*) filter (where type = 'pv' and product_id is not null)::int from events where ${bounds}
      union all select 'atc', count(*) filter (where type = 'atc')::int from events where ${bounds}
      union all select 'checkout_step_1', count(*) filter (where type = 'checkout_step' and (props_json->>'step') = '1')::int from events where ${bounds}
      union all select 'checkout_step_2', count(*) filter (where type = 'checkout_step' and (props_json->>'step') = '2')::int from events where ${bounds}
      union all select 'checkout_step_3', count(*) filter (where type = 'checkout_step' and (props_json->>'step') = '3')::int from events where ${bounds}
      union all select 'sessions', count(distinct nullif(session_hash, ''))::int from events where ${bounds}
      union all select 'search_count', count(*) filter (where type = 'search')::int from events where ${bounds}
      union all select 'search_zero', count(*) filter (where type = 'search' and (props_json->>'zero') = 'true')::int from events where ${bounds}
      union all select 'installs', count(*) filter (where type = 'install')::int from events where ${bounds}
      union all select 'concierge_requests', count(*) filter (where type = 'concierge')::int from events where ${bounds}
      union all select 'otp_sent', count(*)::int from sms_log where status = 'sent' and template = 'otp' and (created_at at time zone 'Asia/Tehran')::date = ${day}
      union all select 'sms_sent', count(*)::int from sms_log where status = 'sent' and template <> 'otp' and (created_at at time zone 'Asia/Tehran')::date = ${day}
    `);
    const sales = await tx.execute<{ purchases: number; revenue: number }>(
      sql`select count(*)::int as purchases, coalesce(sum(o.grand_total), 0)::bigint as revenue from orders o where ${paidBounds}`,
    );
    const purchases = Number(sales[0]?.purchases ?? 0);
    const revenue = Number(sales[0]?.revenue ?? 0);
    const byMetric = new Map<string, number>();
    for (const r of counts) byMetric.set(r.metric, Number(r.value ?? 0));
    const sessions = byMetric.get("sessions") ?? 0;
    const scalars: [string, number][] = [
      ...byMetric.entries(),
      ["purchases", purchases],
      ["revenue", revenue],
      ["aov", purchases === 0 ? 0 : Math.round(revenue / purchases)],
      ["conversion", sessions === 0 ? 0 : Math.round((purchases / sessions) * 10_000) / 10_000],
    ];
    for (const [metric, value] of scalars) {
      await tx.execute(sql`insert into metrics_daily (day, metric, dim, value) values (${day}, ${metric}, '', ${value})`);
      written += 1;
    }
    // DECISION (M8 completion): the dimensioned metrics of the contract are materialised too (top 20 per
    // metric) so the analytics pages can read one table for past days; dashboard.ts still answers the
    // live ranges straight from `events`.
    const dims = await tx.execute<{ metric: string; dim: string | null; value: number }>(sql`
      (select 'top_pages' as metric, path as dim, count(*)::int as value from events where ${bounds} and type = 'pv' group by path order by 3 desc limit 20)
      union all
      (select 'top_products', oi.product_id::text, sum(oi.qty)::int from order_items oi join orders o on o.id = oi.order_id where ${paidBounds} group by oi.product_id order by 3 desc limit 20)
      union all
      (select 'sources', coalesce(nullif(props_json->>'utm_source', ''), nullif(substring(ref from '^[a-z]+://([^/]+)'), ''), 'direct'), count(distinct session_hash)::int
         from events where ${bounds} and type = 'pv' group by 2 order by 3 desc limit 20)
      union all
      (select 'ua_class', ua_class::text, count(distinct session_hash)::int from events where ${bounds} and session_hash <> '' group by ua_class)
    `);
    for (const r of dims) {
      await tx.execute(sql`insert into metrics_daily (day, metric, dim, value) values (${day}, ${r.metric}, ${r.dim ?? ""}, ${Number(r.value ?? 0)})`);
      written += 1;
    }
  });
  return { metrics: written };
}

export async function pruneEvents(db: Db, retentionMonths: number, now: Date): Promise<{ droppedPartitions: string[] }> {
  // DECISION (M8 browser check): `events` IS partitioned by month (migration 0001 [M1]) and the grant
  // matrix gives nl_worker EXECUTE on nl_events_drop_old_partitions but no DELETE on the table, so
  // pruning drops whole partitions through that SECURITY DEFINER function (retain = retentionMonths).
  // The function returns the number of partitions dropped; the names are reported synthetically as
  // `events_<n>` so the handler's log keeps its count. `now` is the function's clock (current month).
  void now;
  const res = await db.execute(sql`select nl_events_drop_old_partitions(${Math.max(1, Math.trunc(retentionMonths))}) as dropped`);
  const first = (res as unknown as { rows?: { dropped?: unknown }[] }).rows?.[0] ?? (res as unknown as { dropped?: unknown }[])[0];
  const dropped = Number(first?.dropped ?? 0);
  return { droppedPartitions: Array.from({ length: Number.isFinite(dropped) ? dropped : 0 }, (_, i) => `events_${String(i + 1)}`) };
}

export async function backfill(db: Db, fromDay: string, toDay: string): Promise<number> {
  let days = 0;
  const cursor = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  while (cursor <= end) {
    await rollupDay(db, cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    days += 1;
    if (days > 1000) break;
  }
  return days;
}
