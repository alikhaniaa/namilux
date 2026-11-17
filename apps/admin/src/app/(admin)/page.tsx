import Link from "next/link";
import { SALES_CHANNELS, can, channelScope, dashboard } from "@namilux/core";
import type { DashboardRange } from "@namilux/core";
import { InboxCounts } from "@/components/dashboard/InboxCounts";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { LowStock } from "@/components/dashboard/LowStock";
import { OrdersByStatus } from "@/components/dashboard/OrdersByStatus";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { SiteSplit } from "@/components/dashboard/SiteSplit";
import { SmsSpend } from "@/components/dashboard/SmsSpend";
import { SystemHealth } from "@/components/dashboard/SystemHealth";
import { TopProducts } from "@/components/dashboard/TopProducts";
import { SiteScopeBadge } from "@/components/orders/SiteSwitch";
import { Card, PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/session";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const r = first(sp.range);
  const range: DashboardRange = r === "today" || r === "7d" ? r : "30d";
  const smsDailyBudget = Number(process.env.SMS_DAILY_BUDGET_TOMAN ?? 2_000_000) || 2_000_000;
  // A staff member confined to one storefront sees that storefront's figures and nothing else.
  const scope = channelScope(staff);
  const data = await dashboard(db, range, { now: new Date(), smsDailyBudget, ...(scope === null ? {} : { channel: scope }) });
  const money = can(staff, "analytics.read");
  const rangeLabel = fa[`dash.${range}`];
  const firstName = staff.name.trim().split(/\s+/)[0] ?? staff.name;

  return (
    <div className="dash">
      <PageHeader
        title={fa["dash.greeting"].replace("{name}", firstName)}
        subtitle={scope === null ? fa["dash.greeting.sub"] : fa["dash.greeting.subScoped"]}
        {...(scope === null ? {} : { badge: <SiteScopeBadge channel={scope} /> })}
        actions={
          <nav className="ui-segmented" aria-label={fa["dash.range"]}>
            {(["today", "7d", "30d"] as const).map((k) => (
              <Link key={k} href={`/?range=${k}`} className="ui-segmented__item" aria-current={range === k ? "page" : undefined}>
                {fa[`dash.${k}`]}
              </Link>
            ))}
          </nav>
        }
      />
      {/* Revenue, AOV and conversion are SALES figures: `analytics.read`, i.e. the head admin - or,
          confined to one storefront, that storefront's own. An admin gets the day's work instead. */}
      {can(staff, "orders.read") || money ? <KpiCards data={data} money={money} rangeLabel={rangeLabel} /> : null}

      {money ? (
        <div className="dash__row dash__row--chart">
          <Card title={fa["dash.chart.title"]} description={fa["dash.chart.sub"]} className="dash__chart">
            <SalesChart series={data.series} sites={scope === null ? [...SALES_CHANNELS] : [scope]} />
          </Card>
          {scope === null ? <SiteSplit byChannel={data.byChannel} rangeLabel={rangeLabel} /> : can(staff, "orders.read") ? <OrdersByStatus counts={data.ordersByStatus} /> : null}
        </div>
      ) : null}

      <div className="dash__grid">
        {can(staff, "orders.read") && !(money && scope !== null) ? <OrdersByStatus counts={data.ordersByStatus} /> : null}
        {can(staff, "inbox.read") && scope === null ? <InboxCounts inbox={data.inbox} /> : null}
        {/* TopProducts carries a revenue column, so it is money too. */}
        {money ? <TopProducts items={data.topProducts} /> : null}
        {can(staff, "catalog.read") && scope === null ? <LowStock items={data.lowStock} /> : null}
        {can(staff, "settings.read") ? <SmsSpend otp={data.otp} money={money} /> : null}
        {can(staff, "system.jobs") ? <SystemHealth jobs={data.jobs} lastBackupAt={data.lastBackupAt} workerHeartbeatAt={data.workerHeartbeatAt} revalidateQueue={data.revalidateQueue} /> : null}
      </div>
    </div>
  );
}
