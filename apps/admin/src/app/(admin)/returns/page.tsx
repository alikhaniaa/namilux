import { can, channelScope, listReturns } from "@namilux/core";
import { Pagination } from "@/components/data/Pagination";
import { Filters } from "@/components/data/Filters";
import { ReturnsTable } from "@/components/orders/ReturnsTable";
import { SiteScopeBadge, SiteSwitch } from "@/components/orders/SiteSwitch";
import { PageHeader } from "@/components/kit";
import { siteFor } from "@/lib/scope";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("orders.read");
  const sp = await searchParams;
  const status = first(sp.status);
  // A staff member confined to one storefront sees that storefront's returns, whatever the URL says.
  const scope = channelScope(staff);
  const channel = siteFor(staff, first(sp.channel));
  const list = await listReturns(db, {
    ...(status === "pending" || status === "accepted" || status === "rejected" ? { status } : {}),
    ...(channel === undefined ? {} : { channel }),
    page: Math.max(1, Number(first(sp.page)) || 1),
  });
  const keep: Record<string, string> = {};
  if (status !== undefined) keep.status = status;
  return (
    <div>
      <PageHeader title={fa["returns.title"]} count={list.total} />
      <div className="page-bar">{scope === null ? <SiteSwitch basePath="/returns" params={keep} current={channel} /> : <SiteScopeBadge channel={scope} />}</div>
      <Filters defs={[{ key: "status", label: fa["common.status"], kind: "select", options: (["pending", "accepted", "rejected"] as const).map((s) => ({ value: s, label: fa[`returns.status.${s}`] })) }]} />
      <ReturnsTable items={list.items} canDecide={can(staff, "orders.refund")} showChannel={channel === undefined} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
