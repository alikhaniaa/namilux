import { getSettings } from "@namilux/core";
import { LoyaltyRulesForm } from "@/components/marketing/LoyaltyRulesForm";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function LoyaltyPage() {
  await requirePermission("marketing.loyalty");
  const settings = await getSettings(db);
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["nav.loyalty"]} />
      <LoyaltyRulesForm initial={settings["loyalty.rules"]} />
    </div>
  );
}
