import { statusLabel } from "@/i18n/admin-labels";
import { Plus } from "lucide-react";
import Link from "next/link";
import { formatJalali, listPagesAdmin } from "@namilux/core";
import { ButtonLink, EmptyRow, PageHeader, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa, pageTemplateLabel } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function PagesPage() {
  await requirePermission("content.write");
  const items = await listPagesAdmin(db);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={fa["nav.pages"]} count={items.length}
        actions={
          <ButtonLink href="/content/pages/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["pages.new"]}
          </ButtonLink>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>{fa["posts.title"]}</Th>
            <Th>{fa["pages.template"]}</Th>
            <Th>{fa["common.status"]}</Th>
            <Th>{fa["common.date"]}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <Td>
                <Link href={`/content/pages/${String(p.id)}`} className="hover:text-[var(--accent)]">
                  {p.title}
                </Link>
                <span className="block ltr text-[11px] text-[var(--ink-3)]">{p.slug}</span>
              </Td>
              <Td ltr className="text-xs">
                {pageTemplateLabel(p.template)}
              </Td>
              <Td>
                <StatusBadge tone={p.status === "published" ? "ok" : "muted"}>{statusLabel(p.status)}</StatusBadge>
              </Td>
              <Td className="text-xs text-[var(--ink-2)]">{p.updatedAt === "" ? "ثبت نشده" : formatJalali(p.updatedAt, "short")}</Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={4} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
    </div>
  );
}
