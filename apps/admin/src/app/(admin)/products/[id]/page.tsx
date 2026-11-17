import { notFound } from "next/navigation";
import { can, channelScope, redactProductAdminView } from "@namilux/core";
import { getProductAdmin, listProductImagesAdmin, loadAux, viewToInput } from "../_shared";
import { ProductForm } from "@/components/products/ProductForm";
import { PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("catalog.read");
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) notFound();
  const loaded = await getProductAdmin(db, pid);
  // A staff member confined to the instalment site sees only what that site may sell.
  if (loaded === null || (channelScope(staff) === "instalments" && !loaded.row.instalmentEligible)) notFound();
  const canCost = can(staff, "catalog.cost");
  // Redacted before anything renders: the cost never reaches the RSC payload of an admin's page.
  const view = redactProductAdminView(loaded, canCost);
  const images = await listProductImagesAdmin(db, pid);
  const aux = await loadAux(view, images, canCost, can(staff, "catalog.price"));
  return (
    <div>
      <PageHeader
        title={view.row.displayName}
        {...(view.row.sku === null ? {} : { subtitle: view.row.sku })}
        actions={<StatusBadge tone={view.row.status === "active" ? "ok" : view.row.status === "archived" ? "muted" : "default"}>{fa[`products.status.${view.row.status}`]}</StatusBadge>}
      />
      <ProductForm initial={viewToInput(view, images, aux.attributes, canCost)} aux={aux} readOnly={!can(staff, "catalog.write")} />
    </div>
  );
}
