import { listStaff } from "@namilux/core";
import { StaffTable } from "@/components/settings/StaffTable";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function StaffPage() {
  const staff = await requirePermission("staff.manage");
  const items = await listStaff(db);
  return <StaffTable title={fa["settings.staff"]} items={items} selfId={staff.id} />;
}
