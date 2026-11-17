import { can } from "@namilux/core";
import { emptyProduct, loadAux } from "../_shared";
import { ProductForm } from "@/components/products/ProductForm";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";

export default async function NewProductPage() {
  const staff = await requirePermission("catalog.write");
  const canCost = can(staff, "catalog.cost");
  const aux = await loadAux(null, [], canCost, can(staff, "catalog.price"));
  return (
    <div>
      <PageHeader title={fa["products.new"]} />
      <ProductForm initial={emptyProduct(canCost)} aux={aux} />
    </div>
  );
}
