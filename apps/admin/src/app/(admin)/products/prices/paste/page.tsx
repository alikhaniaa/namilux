import { listPriceSheet } from "@namilux/core";
import { PasteList } from "@/components/pricing/PasteList";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function PasteListPage() {
  await requirePermission("catalog.bulk");
  return <PasteList rows={await listPriceSheet(db)} />;
}
