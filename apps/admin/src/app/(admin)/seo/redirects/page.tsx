import { listRedirects } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { RedirectTable } from "@/components/seo/RedirectTable";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function RedirectsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("seo.write");
  const sp = await searchParams;
  const search = first(sp.q);
  const source = first(sp.source);
  const list = await listRedirects(db, {
    page: Math.max(1, Number(first(sp.page)) || 1),
    ...(search === undefined || search.trim() === "" ? {} : { search }),
    ...(source === "legacy" || source === "manual" || source === "auto_archive" ? { source } : {}),
  });
  return (
    <div>
      <PageHeader title={fa["nav.redirects"]} count={list.total} />
      <Filters
        defs={[
          { key: "q", label: fa["common.search"], kind: "text" },
          { key: "source", label: fa["redirects.source"], kind: "select", options: ["legacy", "manual", "auto_archive"].map((s) => ({ value: s, label: s })) },
        ]}
      />
      <RedirectTable items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
