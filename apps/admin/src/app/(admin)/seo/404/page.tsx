import { faInt, listNotFound } from "@namilux/core";
import Link from "next/link";
import { Pagination } from "@/components/data/Pagination";
import { NotFoundMonitor } from "@/components/seo/NotFoundMonitor";
import { PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function NotFoundPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("seo.write");
  const sp = await searchParams;
  const daysRaw = Number(first(sp.days));
  const days = Number.isInteger(daysRaw) && daysRaw > 0 ? Math.min(365, daysRaw) : 30;
  const list = await listNotFound(db, { days, page: Math.max(1, Number(first(sp.page)) || 1) });
  return (
    <div>
      <PageHeader
        title={fa["nav.notfound"]} count={list.total}
        actions={
          <nav className="ui-segmented" aria-label={fa["dash.range"]}>
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/seo/404?days=${String(d)}`} aria-current={days === d ? "page" : undefined} className="ui-segmented__item">
                {fa["notfound.daysN"].replace("{n}", faInt(d))}
              </Link>
            ))}
          </nav>
        }
      />
      <NotFoundMonitor items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
