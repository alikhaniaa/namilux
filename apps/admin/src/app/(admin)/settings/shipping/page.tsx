import { listShippingMethodsAdmin } from "@namilux/core";
import { ShippingMethodsEditor } from "@/components/settings/ShippingMethodsEditor";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function ShippingPage() {
  await requirePermission("settings.read");
  const items = await listShippingMethodsAdmin(db);
  return (
    <div className="max-w-4xl">
      <PageHeader title={fa["shipping.title"]} />
      <ShippingMethodsEditor items={items} />
    </div>
  );
}
