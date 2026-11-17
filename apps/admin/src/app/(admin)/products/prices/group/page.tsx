import { adminProductIds, listBrands, listCategoryTree, listPriceSheet } from "@namilux/core";
import { faInt } from "@namilux/core/client";
import { GroupChange } from "@/components/pricing/GroupChange";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { hasFilterCriteria, parseProductFilter } from "@/lib/product-filters";
import { flatCategories } from "../_shared";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** The ids a product-list selection arrived with; anything that is not a positive integer is dropped. */
function parseIds(raw: string | undefined): number[] {
  return [...new Set((raw ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

export default async function GroupChangePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("catalog.bulk");
  const sp = await searchParams;
  // The product list hands over either the rows that were ticked or the filter it was showing. The
  // filter is resolved by the list's own predicate, so «همهٔ نتایج» is exactly what the list listed.
  const ids = parseIds(first(sp.ids));
  const filter = parseProductFilter(sp);
  const fromFilter = ids.length === 0 && hasFilterCriteria(filter);
  const [rows, brands, tree, matched] = await Promise.all([
    listPriceSheet(db),
    listBrands(db),
    listCategoryTree(db),
    fromFilter ? adminProductIds(db, filter) : Promise.resolve(null),
  ]);
  const selection = ids.length > 0 ? ids : matched;
  const note =
    selection === null ? null
      : ids.length > 0 ? `${faInt(selection.length)} کالایی که در فهرست محصولات تیک زده‌اید`
        : `${faInt(selection.length)} کالا از فیلتر فهرست محصولات`;
  return <GroupChange rows={rows} brands={brands.map((b) => ({ id: b.id, name: b.name }))} categories={flatCategories(tree)} selection={selection} selectionNote={note} />;
}
