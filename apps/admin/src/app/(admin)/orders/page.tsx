import { Plus } from "lucide-react";
import { can, channelScope, listOrders, orderMethodCounts, snapppayAttention } from "@namilux/core";
import type { OrderQuery, OrderSource, OrderStatus } from "@namilux/core";
import { OrderTable } from "@/components/orders/OrderTable";
import { SiteScopeBadge } from "@/components/orders/SiteSwitch";
import { METHOD_FILTERS, PaymentMethodSwitch } from "@/components/orders/PaymentMethodSwitch";
import type { MethodFilter } from "@/components/orders/PaymentMethodSwitch";
import { ButtonLink, PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { siteFor } from "@/lib/scope";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : v.split(","));
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const STATUSES = new Set<string>(["draft", "pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "refunded", "returned", "expired", "failed"]);
const SOURCES = new Set<string>(["web", "admin", "phone", "instagram", "whatsapp"]);

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("orders.read");
  const sp = await searchParams;
  const pageSizeRaw = Number(first(sp.pageSize));
  const q: OrderQuery = { page: Math.max(1, Number(first(sp.page)) || 1), pageSize: pageSizeRaw === 100 ? 100 : pageSizeRaw === 200 ? 200 : 50 };
  const search = first(sp.q);
  if (search !== undefined && search.trim() !== "") q.q = search;
  const status = all(sp.status).filter((s): s is OrderStatus => STATUSES.has(s));
  if (status.length > 0) q.status = status;
  const source = all(sp.source).filter((s): s is OrderSource => SOURCES.has(s));
  if (source.length > 0) q.source = source;
  // Which storefront placed it - the switch above the table; a staff member confined to one site
  // gets that site whatever the URL says (lib/scope.ts).
  const scope = channelScope(staff);
  const channel = siteFor(staff, first(sp.channel));
  if (channel !== undefined) q.channel = channel;
  // How it was paid - the switch above the table (card / SnappPay / no online payment).
  const methodRaw = first(sp.method);
  const method = METHOD_FILTERS.find((m): m is MethodFilter => m === methodRaw);
  if (method !== undefined) q.method = method;
  const attentionOn = first(sp.attention) === "1";
  if (attentionOn) q.attention = true;
  const from = first(sp.from);
  if (from !== undefined && from !== "") q.from = from;
  const to = first(sp.to);
  if (to !== undefined && to !== "") q.to = to;
  const [list, counts, attention] = await Promise.all([listOrders(db, q), orderMethodCounts(db, q), snapppayAttention(db)]);

  // The query the switch keeps when the site changes: everything on the URL but the site and page.
  const keep: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const value = first(v);
    if (value !== undefined && k !== "page") keep[k] = value;
  }

  return (
    <div>
      <PageHeader
        title={fa["nav.orders"]}
        count={list.total}
        actions={
          can(staff, "orders.create") ? (
            <ButtonLink href="/orders/new" icon={<Plus size={16} aria-hidden="true" />}>
              {fa["orders.new"]}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="page-bar">
        {scope === null ? null : <SiteScopeBadge channel={scope} />}
        <PaymentMethodSwitch params={keep} current={method} counts={counts} attention={attention} attentionOn={attentionOn} />
      </div>
      <OrderTable rows={list.items} total={list.total} page={list.page} pageSize={list.pageSize} view={first(sp.view) ?? ""} />
    </div>
  );
}
