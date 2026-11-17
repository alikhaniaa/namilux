import { AccountPanel } from "@/components/settings/AccountPanel";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requireStaff } from "@/lib/session";

export default async function AccountPage() {
  const staff = await requireStaff();
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["nav.account"]} subtitle={`${staff.name} · ${staff.email} · ${fa[`role.${staff.role}`]}`} />
      <AccountPanel />
    </div>
  );
}
