import { notFound } from "next/navigation";
import { can, channelScope, customerDetail, formatJalali } from "@namilux/core";
import { CustomerDetail } from "@/components/customers/CustomerDetail";
import { PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("customers.read");
  const { id } = await params;
  const site = channelScope(staff);
  const data = await customerDetail(db, id, site === null ? {} : { channel: site }).catch(() => null);
  if (data === null) notFound();
  const c = data.customer;
  return (
    <div>
      <PageHeader
        title={[c.firstName, c.lastName].filter((s) => s !== null && s !== "").join(" ") || fa["customers.name"]}
        subtitle={`${fa["customers.joined"]}: ${formatJalali(c.createdAt, "short")}`}
        actions={c.isBlocked ? <StatusBadge tone="warn">{fa["customers.blocked"]}</StatusBadge> : <StatusBadge tone="ok">{fa[`customers.tier.${c.tier}`]}</StatusBadge>}
      />
      <CustomerDetail data={data} canWrite={can(staff, "customers.write")} canPoints={can(staff, "customers.points")} />
    </div>
  );
}
