import { notFound } from "next/navigation";
import { getSettings, invoiceView, ordersRepo } from "@namilux/core";
import { InvoicePrint } from "@/components/orders/InvoicePrint";
import { PrintButton } from "@/components/orders/PrintButton";
import { requirePermission } from "@/lib/authz";
import { inScope } from "@/lib/scope";
import { db } from "@/lib/db";

export default async function InvoicePage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requirePermission("orders.read");
  const { code } = await params;
  const order = await ordersRepo.findByCode(db, code.toUpperCase());
  if (order === null || !inScope(staff, order.channel)) notFound();
  const settings = await getSettings(db);
  const view = await invoiceView(db, order.id, { settings }).catch(() => null);
  if (view === null) notFound();
  return (
    <div>
      <div className="mb-3 print:hidden">
        <PrintButton />
      </div>
      <InvoicePrint v={view} />
    </div>
  );
}
