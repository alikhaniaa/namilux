import { notFound } from "next/navigation";
import { formatJalali, listStaff, listStaffSessions } from "@namilux/core";
import { SessionsTable } from "@/components/settings/SessionsTable";
import { StaffEditForm } from "@/components/settings/StaffEditForm";
import { Card, PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("staff.manage");
  const { id } = await params;
  const row = (await listStaff(db)).find((s) => s.id === id);
  if (row === undefined) notFound();
  const sessions = await listStaffSessions(db, id);
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title={row.name} subtitle={row.email} actions={<StatusBadge tone={row.isActive ? "ok" : "muted"}>{row.role}</StatusBadge>} />
      <Card title={fa["staff.edit"]}>
        <StaffEditForm id={row.id} name={row.name} role={row.role} self={row.id === staff.id} />
      </Card>
      <Card>
        <dl className="grid grid-cols-2 gap-1 text-sm md:grid-cols-4">
          <dt className="text-[var(--ink-2)]">{fa["staff.totp"]}</dt>
          <dd>{row.totpEnabled ? fa["common.yes"] : fa["common.no"]}</dd>
          <dt className="text-[var(--ink-2)]">{fa["staff.lastLogin"]}</dt>
          <dd>{row.lastLoginAt === null ? fa["common.none"] : formatJalali(row.lastLoginAt, "short")}</dd>
        </dl>
      </Card>
      <Card title={fa["settings.sessions"]}>
        <SessionsTable items={sessions} revokeUrl={`/api/staff/${encodeURIComponent(id)}?session={id}`} />
      </Card>
    </div>
  );
}
