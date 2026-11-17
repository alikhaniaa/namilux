import { FileUp, Plus, Tags } from "lucide-react";
import { can, channelScope, listAdmin, listBrands } from "@namilux/core";
import { ProductTable } from "@/components/products/ProductTable";
import { ButtonLink, PageHeader } from "@/components/kit";
import { SiteScopeBadge } from "@/components/orders/SiteSwitch";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { parseProductFilter } from "@/lib/product-filters";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("catalog.read");
  const sp = await searchParams;
  // The same parser the pricing section's group change uses, so a filter-scope price change reaches
  // exactly the rows this page lists - including the folded `q` and the paging-independent keys.
  const filter = parseProductFilter(sp);
  // Confined to the instalment site: the products it may sell, nothing else.
  const scope = channelScope(staff);
  if (scope === "instalments") filter.instalmentEligible = true;
  const [list, brands] = await Promise.all([listAdmin(db, filter), listBrands(db)]);
  return (
    <div>
      <PageHeader
        title={fa["products.title"]}
        count={list.total}
        {...(scope === null ? {} : { badge: <SiteScopeBadge channel={scope} /> })}
        actions={
          <>
            {can(staff, "catalog.price") && scope === null ? (
              <ButtonLink href="/products/prices" variant="outline" icon={<Tags size={16} aria-hidden="true" />}>
                {fa["nav.prices"]}
              </ButtonLink>
            ) : null}
            {can(staff, "catalog.bulk") ? (
              <ButtonLink href="/products/import" variant="outline" icon={<FileUp size={16} aria-hidden="true" />} className="hidden md:inline-flex">
                {fa["products.import"]}
              </ButtonLink>
            ) : null}
            {can(staff, "catalog.write") ? (
              <ButtonLink href="/products/new" icon={<Plus size={16} aria-hidden="true" />}>
                {fa["products.new"]}
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <ProductTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={filter.pageSize ?? 50}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        filter={filter}
        canPrice={can(staff, "catalog.price")}
        canBulk={can(staff, "catalog.bulk")}
        canWrite={can(staff, "catalog.write")}
        view={first(sp.view) ?? ""}
        instalmentView={scope === "instalments"}
      />
    </div>
  );
}
