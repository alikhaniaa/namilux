import { listBrands, listCategoryTree, listPriceSheet } from "@namilux/core";
import { QuickPrices } from "@/components/pricing/QuickPrices";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { flatCategories } from "./_shared";

export default async function QuickPricesPage() {
  await requirePermission("catalog.price");
  const [rows, brands, tree] = await Promise.all([listPriceSheet(db), listBrands(db), listCategoryTree(db)]);
  return <QuickPrices initialRows={rows} brands={brands.map((b) => ({ id: b.id, name: b.name }))} categories={flatCategories(tree)} now={Date.now()} />;
}
