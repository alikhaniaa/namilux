import { listFaqsAdmin } from "@namilux/core";
import { FaqEditor } from "@/components/content/FaqEditor";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function FaqPage() {
  await requirePermission("content.write");
  const items = await listFaqsAdmin(db);
  const groups = Array.from(new Set(items.map((i) => i.groupKey)));
  return <FaqEditor title={fa["nav.faq"]} items={items} groups={groups.length === 0 ? ["general", "shipping", "warranty", "returns", "payment"] : groups} />;
}
