import { statusLabel } from "@/i18n/admin-labels";
import { faInt, jobs } from "@namilux/core";
import type { JobStatus } from "@namilux/core";
import { Filters } from "@/components/data/Filters";
import { Pagination } from "@/components/data/Pagination";
import { JobsTable } from "@/components/system/JobsTable";
import { Kpi, PageHeader } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const STATUSES = ["queued", "running", "done", "failed", "dead"] as const;

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("system.jobs");
  const sp = await searchParams;
  const status = first(sp.status);
  const [stats, list] = await Promise.all([
    jobs.stats(db),
    jobs.list(db, { page: Math.max(1, Number(first(sp.page)) || 1), ...(STATUSES.includes(status as JobStatus) ? { status: status as JobStatus } : {}) }),
  ]);
  return (
    <div>
      <PageHeader title={fa["nav.jobs"]} />
      <div className="mb-4 grid grid-cols-3 gap-3 md:grid-cols-6">
        {STATUSES.map((k) => (
          <Kpi key={k} label={statusLabel(k)} value={faInt(stats[k])} tone={(k === "failed" || k === "dead") && stats[k] > 0 ? "warn" : "default"} />
        ))}
        <Kpi label="زمان انتظار قدیمی‌ترین کار" value={`${faInt(stats.oldestQueuedSec)} ثانیه`} tone={stats.oldestQueuedSec > 300 ? "warn" : "default"} />
      </div>
      <Filters defs={[{ key: "status", label: fa["common.status"], kind: "select", options: STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) }]} />
      <JobsTable items={list.items} />
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} />
    </div>
  );
}
