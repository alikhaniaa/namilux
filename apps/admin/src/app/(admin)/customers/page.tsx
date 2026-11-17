import { can, channelScope, listCustomers } from "@namilux/core";
import type { CustomerQuery, CustomerTier } from "@namilux/core";
import { CustomerTable } from "@/components/customers/CustomerTable";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const all = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : v.split(","));
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const TIERS = new Set<string>(["member", "silver", "gold", "diamond"]);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("customers.read");
  const sp = await searchParams;
  const pageSizeRaw = Number(first(sp.pageSize));
  const q: CustomerQuery = { page: Math.max(1, Number(first(sp.page)) || 1), pageSize: pageSizeRaw === 100 ? 100 : pageSizeRaw === 200 ? 200 : 50 };
  const search = first(sp.q);
  if (search !== undefined && search.trim() !== "") q.q = search;
  const tier = all(sp.tier).filter((t): t is CustomerTier => TIERS.has(t));
  if (tier.length > 0) q.tier = tier;
  const blocked = first(sp.blocked);
  if (blocked === "1" || blocked === "0") q.blocked = blocked === "1";
  const optIn = first(sp.optIn);
  if (optIn === "1" || optIn === "0") q.optIn = optIn === "1";
  const site = channelScope(staff);
  if (site !== null) q.channel = site;
  const list = await listCustomers(db, q);
  const exportQuery = new URLSearchParams();
  if (q.q !== undefined) exportQuery.set("q", q.q);
  for (const t of tier) exportQuery.append("tier", t);
  if (q.blocked !== undefined) exportQuery.set("blocked", q.blocked ? "1" : "0");
  if (q.optIn !== undefined) exportQuery.set("optIn", q.optIn ? "1" : "0");
  return (
    <div>
      <PageHeader title={fa["nav.customers"]} count={list.total} />
      <CustomerTable rows={list.items} total={list.total} page={list.page} pageSize={list.pageSize} canExport={can(staff, "customers.export")} exportQuery={exportQuery.toString()} />
    </div>
  );
}
