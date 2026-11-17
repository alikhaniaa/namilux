import { jobs, listBrands } from "@namilux/core";
import { SmsCampaignForm } from "@/components/marketing/SmsCampaignForm";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function SmsPage() {
  await requirePermission("marketing.sms");
  const [brands, list] = await Promise.all([listBrands(db), jobs.list(db, { type: "sms.campaign", page: 1 })]);
  const history = list.items.map((j) => ({
    id: j.id,
    status: j.status,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    name: typeof j.payload.name === "string" ? j.payload.name : "",
    text: typeof j.payload.text === "string" ? j.payload.text : "",
    budgetToman: typeof j.payload.budgetToman === "number" ? j.payload.budgetToman : 0,
    dryRun: j.payload.dryRun === true,
    lastError: j.lastError,
  }));
  return (
    <div className="max-w-5xl">
      <PageHeader title={fa["nav.sms"]} />
      <SmsCampaignForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} history={history} />
    </div>
  );
}
