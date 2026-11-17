import { Plus } from "lucide-react";
import Link from "next/link";
import { faInt, listCollections } from "@namilux/core";
import { ButtonLink, EmptyRow, PageHeader, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requireBothSites } from "@/lib/scope";
import { db } from "@/lib/db";
import { adminImg } from "@/lib/media";

export default async function CollectionsPage() {
  await requireBothSites("catalog.read");
  const items = await listCollections(db);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={fa["collections.title"]} count={items.length}
        actions={
          <ButtonLink href="/collections/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["collections.new"]}
          </ButtonLink>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th />
            <Th>{fa["common.name"]}</Th>
            <Th>{fa["collections.kind"]}</Th>
            <Th>{fa["common.productCount"]}</Th>
            <Th>{fa["cat.sort"]}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-[var(--line)]">
              <Td>{c.cover !== null ? <img src={adminImg(c.cover, 160)} alt="" className="h-10 w-16 object-cover" loading="lazy" /> : null}</Td>
              <Td>
                <Link href={`/collections/${String(c.id)}`} className="hover:text-[var(--accent)]">
                  {c.name}
                </Link>
                <span className="ms-2 ltr text-xs text-[var(--ink-2)]">{c.slug}</span>
              </Td>
              <Td>
                <StatusBadge>{fa[`collections.kind.${c.kind}`]}</StatusBadge>
              </Td>
              <Td className="tabular-nums">{faInt(c.productCount)}</Td>
              <Td className="tabular-nums">{faInt(c.sort)}</Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
    </div>
  );
}
