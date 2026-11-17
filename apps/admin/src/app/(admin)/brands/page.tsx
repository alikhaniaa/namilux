import { Plus } from "lucide-react";
import Link from "next/link";
import { faInt, listBrands } from "@namilux/core";
import { ButtonLink, EmptyRow, PageHeader, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requireBothSites } from "@/lib/scope";
import { db } from "@/lib/db";
import { adminImg } from "@/lib/media";

export default async function BrandsPage() {
  await requireBothSites("catalog.read");
  const brands = await listBrands(db);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={fa["brands.title"]} count={brands.length}
        actions={
          <ButtonLink href="/brands/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["brands.new"]}
          </ButtonLink>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th />
            <Th>{fa["brands.nameFa"]}</Th>
            <Th>{fa["brands.nameEn"]}</Th>
            <Th>{fa["common.productCount"]}</Th>
            <Th>{fa["common.status"]}</Th>
          </tr>
        </thead>
        <tbody>
          {brands.map((b) => (
            <tr key={b.id} className="border-t border-[var(--line)]">
              <Td>{b.logo !== null ? <img src={adminImg(b.logo, 160)} alt="" className="h-8 w-16 object-contain" loading="lazy" /> : null}</Td>
              <Td>
                <Link href={`/brands/${String(b.id)}`} className="hover:text-[var(--accent)]">
                  {b.name}
                </Link>
              </Td>
              <Td ltr className="text-xs">
                {b.nameEn}
              </Td>
              <Td className="tabular-nums">
                {faInt(b.productCount)} <span className="text-xs text-[var(--ink-2)]">({faInt(b.buyableCount)})</span>
              </Td>
              <Td>
                <StatusBadge tone={b.isActive ? "ok" : "muted"}>{b.isActive ? fa["common.active"] : fa["common.inactive"]}</StatusBadge>
              </Td>
            </tr>
          ))}
          {brands.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
    </div>
  );
}
