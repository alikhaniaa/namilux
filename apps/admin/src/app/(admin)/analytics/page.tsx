import { funnel, sources, topPages, uaClasses, zeroResultSearches } from "@namilux/core";
import type { DashboardRange } from "@namilux/core";
import Link from "next/link";
import { Funnel } from "@/components/analytics/Funnel";
import { SearchTerms } from "@/components/analytics/SearchTerms";
import { Sources } from "@/components/analytics/Sources";
import { TopPages } from "@/components/analytics/TopPages";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requireBothSites } from "@/lib/scope";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireBothSites("analytics.read");
  const sp = await searchParams;
  const r = first(sp.range);
  const range: DashboardRange = r === "today" || r === "7d" ? r : "30d";
  const [steps, pages, terms, src, devices] = await Promise.all([funnel(db, range), topPages(db, range), zeroResultSearches(db, range), sources(db, range), uaClasses(db, range)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={fa["analytics.title"]}
        actions={
          <nav className="ui-segmented" aria-label={fa["dash.range"]}>
            {(["today", "7d", "30d"] as const).map((k) => (
              <Link key={k} href={`/analytics?range=${k}`} className="ui-segmented__item" aria-current={range === k ? "page" : undefined}>
                {fa[`dash.${k}`]}
              </Link>
            ))}
          </nav>
        }
      />
      <Funnel steps={steps} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TopPages pages={pages} origin={env.SITE_ORIGIN} />
        <SearchTerms terms={terms} />
      </div>
      <Sources sources={src} devices={devices} />
    </div>
  );
}
