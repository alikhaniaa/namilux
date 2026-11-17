import { MONEY_PERMISSIONS, PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, SUDO_PERMISSIONS } from "@namilux/core";
import { RolesTable } from "@/components/settings/RolesTable";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";

export default async function RolesPage() {
  await requirePermission("staff.manage");
  return (
    <div>
      <PageHeader title={fa["settings.roles"]} />
      <RolesTable roles={ROLE_NAMES} permissions={PERMISSIONS} matrix={ROLE_PERMISSIONS} sudo={SUDO_PERMISSIONS} money={MONEY_PERMISSIONS} />
    </div>
  );
}
