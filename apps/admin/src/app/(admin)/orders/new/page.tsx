import { can, listActiveShippingMethods } from "@namilux/core";
import { ManualOrderForm } from "@/components/orders/ManualOrderForm";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function NewOrderPage() {
  const staff = await requirePermission("orders.create");
  const methods = await listActiveShippingMethods(db);
  return (
    <div>
      <PageHeader title={fa["orders.new"]} />
      <ManualOrderForm
        shippingMethods={methods.map((m) => ({ key: m.key, name: m.name }))}
        canOverride={can(staff, "catalog.price")}
        canMarkPaid={can(staff, "orders.manual_payment")}
        payUrlPrefix={`${env.SITE_ORIGIN}/pay/`}
      />
    </div>
  );
}
