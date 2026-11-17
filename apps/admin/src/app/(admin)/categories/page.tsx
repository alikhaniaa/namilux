import { listCategoryTree } from "@namilux/core";
import { CategoryTree } from "@/components/categories/CategoryTree";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requireBothSites } from "@/lib/scope";
import { db } from "@/lib/db";

export default async function CategoriesPage() {
  await requireBothSites("catalog.read");
  const tree = await listCategoryTree(db);
  return <CategoryTree title={fa["cat.title"]} tree={tree} origin={env.SITE_ORIGIN} />;
}
