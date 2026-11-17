import { getSettings, latestSnapshotRun, sitemapCounts } from "@namilux/core";
import { MetaEditor } from "@/components/seo/MetaEditor";
import { ParityReport } from "@/components/seo/ParityReport";
import { SitemapStatus } from "@/components/seo/SitemapStatus";
import { PageHeader } from "@/components/kit";
import { env } from "@/env";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

export default async function SeoPage() {
  await requirePermission("seo.write");
  const [counts, lastRun, settings] = await Promise.all([sitemapCounts(db), latestSnapshotRun(db).catch(() => null), getSettings(db)]);
  const contract = settings["system.contract"] as { ok?: boolean; runAt?: string; total?: number; covered?: number; missing?: number };
  return (
    <div className="space-y-6">
      <PageHeader title={fa["nav.seo"]} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SitemapStatus counts={counts} origin={env.SITE_ORIGIN} />
        <ParityReport data={{ contract: contract.runAt === "" ? null : contract, lastRun }} />
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">{fa["seo.entity"]}</h2>
        <MetaEditor origin={env.SITE_ORIGIN} />
      </section>
    </div>
  );
}
