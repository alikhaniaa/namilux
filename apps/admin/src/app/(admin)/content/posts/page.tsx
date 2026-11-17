import { Plus } from "lucide-react";
import Link from "next/link";
import { formatJalali, listPostsAdmin } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { ButtonLink, EmptyRow, PageHeader, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function PostsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("content.write");
  const sp = await searchParams;
  const status = first(sp.status);
  const search = first(sp.q);
  const list = await listPostsAdmin(db, {
    page: Math.max(1, Number(first(sp.page)) || 1),
    ...(status === "draft" || status === "published" || status === "archived" ? { status } : {}),
    ...(search === undefined || search.trim() === "" ? {} : { search }),
  });
  return (
    <div>
      <PageHeader
        title={fa["nav.posts"]} count={list.total}
        actions={
          <ButtonLink href="/content/posts/new" icon={<Plus size={16} aria-hidden="true" />}>
            {fa["posts.new"]}
          </ButtonLink>
        }
      />
      <Filters
        defs={[
          { key: "q", label: fa["common.search"], kind: "text" },
          { key: "status", label: fa["common.status"], kind: "select", options: (["draft", "published", "archived"] as const).map((s) => ({ value: s, label: fa[`posts.status.${s}`] })) },
        ]}
      />
      <Table>
        <thead>
          <tr>
            <Th>{fa["posts.title"]}</Th>
            <Th>{fa["posts.author"]}</Th>
            <Th>{fa["common.status"]}</Th>
            <Th>{fa["posts.schedule"]}</Th>
            <Th>{fa["common.date"]}</Th>
          </tr>
        </thead>
        <tbody>
          {list.items.map((p) => (
            <tr key={p.id} className="border-t border-[var(--line)]">
              <Td>
                <Link href={`/content/posts/${String(p.id)}`} className="hover:text-[var(--accent)]">
                  {p.title}
                </Link>
                <span className="block ltr text-[11px] text-[var(--ink-3)]">{p.slug}</span>
              </Td>
              <Td className="text-xs">{p.authorName}</Td>
              <Td>
                <StatusBadge tone={p.status === "published" ? "ok" : p.status === "archived" ? "muted" : "default"}>{fa[`posts.status.${p.status}`]}</StatusBadge>
              </Td>
              <Td className="text-xs">{p.publishedAt === null ? "ثبت نشده" : formatJalali(p.publishedAt, "short")}</Td>
              <Td className="text-xs text-[var(--ink-2)]">{formatJalali(p.updatedAt, "short")}</Td>
            </tr>
          ))}
          {list.items.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
