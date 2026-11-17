import { listAttributes } from "@namilux/core";
import { AttributeTable } from "@/components/attributes/AttributeTable";
import { fa } from "@/i18n/fa";
import { requireBothSites } from "@/lib/scope";
import { db } from "@/lib/db";

export default async function AttributesPage() {
  await requireBothSites("catalog.read");
  const items = await listAttributes(db);
  return <AttributeTable title={fa["attributes.title"]} items={items.map((a) => ({ id: a.id, key: a.key, label: a.label, unit: a.unit, kind: a.kind, isFilterable: a.isFilterable, isComparable: a.isComparable, sort: a.sort }))} />;
}
