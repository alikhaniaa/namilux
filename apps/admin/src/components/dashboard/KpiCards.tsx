import Link from "next/link";
import { Clock, PackageX, Percent, Receipt, ShoppingBag, Undo2, Wallet } from "lucide-react";
import { faInt, formatToman } from "@namilux/core";
import type { DashboardData } from "@namilux/core";
import { Kpi } from "@/components/kit";
import { fa } from "@/i18n/fa";

/** The change against the previous period, or null when there is nothing to compare against. */
function delta(now: number, before: number, label: string): { value: number; label: string } | null {
  if (before <= 0) return null;
  return { value: (now - before) / before, label };
}

/**
 * The key figures. With `money` (analytics.read) they are the SALES of the selected range, each
 * against the period of the same length before it; without it - an admin, who runs the shop but
 * never sees what it earned - the same row carries the day's work instead.
 */
export function KpiCards({ data, money, rangeLabel }: { data: DashboardData; money: boolean; rangeLabel: string }) {
  const vs = fa["dash.vsPrevious"];
  if (!money) {
    const toProcess = (data.ordersByStatus.paid ?? 0) + (data.ordersByStatus.processing ?? 0);
    return (
      <div className="ui-kpi-grid">
        <Link href="/orders?status=paid&status=processing" className="kpi-link">
          <Kpi label={fa["dash.work.process"]} value={faInt(toProcess)} icon={<ShoppingBag size={18} />} hint={fa["dash.work.processHint"]} />
        </Link>
        <Link href="/orders?status=pending_payment" className="kpi-link">
          <Kpi label={fa["dash.work.pending"]} value={faInt(data.ordersByStatus.pending_payment ?? 0)} icon={<Clock size={18} />} hint={fa["dash.work.pendingHint"]} />
        </Link>
        <Link href="/returns?status=pending" className="kpi-link">
          <Kpi label={fa["dash.work.returns"]} value={faInt(data.inbox.returns)} icon={<Undo2 size={18} />} hint={fa["dash.work.returnsHint"]} />
        </Link>
        <Link href="/products?stockState=low" className="kpi-link">
          <Kpi label={fa["dash.lowStock"]} value={faInt(data.lowStock.length)} icon={<PackageX size={18} />} tone={data.lowStock.length > 0 ? "warn" : "default"} hint={fa["dash.work.lowHint"]} />
        </Link>
      </div>
    );
  }
  const p = data.period;
  // Design audit 2 Sep 2026: purchases ÷ sessions above 1 (test orders, no sessions) is a
  // definition artefact, not a rate - show « - » rather than «۱۲۱٪».
  const conversion = Number.isFinite(data.conversion) && data.conversion > 0 && data.conversion <= 1 ? `${faInt(Math.round(data.conversion * 100))}٪` : "—";
  return (
    <div className="ui-kpi-grid">
      <Kpi label={`${fa["dash.revenue"]} · ${rangeLabel}`} value={formatToman(p.revenue)} unit={fa["form.toman"]} icon={<Wallet size={18} />} delta={delta(p.revenue, p.previous.revenue, vs)} hint={fa["dash.noPrevious"]} />
      <Kpi label={fa["dash.paidOrders"]} value={faInt(p.orders)} icon={<ShoppingBag size={18} />} delta={delta(p.orders, p.previous.orders, vs)} hint={fa["dash.noPrevious"]} />
      <Kpi label={fa["dash.aov"]} value={formatToman(p.aov)} unit={fa["form.toman"]} icon={<Receipt size={18} />} delta={delta(p.aov, p.previous.aov, vs)} hint={fa["dash.noPrevious"]} />
      {data.channel === null ? (
        <Kpi label={fa["dash.conversion"]} value={conversion} icon={<Percent size={18} />} hint={fa["dash.conversionHint"]} />
      ) : (
        <Link href="/returns?status=pending" className="kpi-link">
          <Kpi label={fa["dash.work.returns"]} value={faInt(data.inbox.returns)} icon={<Undo2 size={18} />} hint={fa["dash.work.returnsHint"]} />
        </Link>
      )}
    </div>
  );
}
