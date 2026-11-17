import Link from "next/link";
import { faInt, formatJalali, formatRelative } from "@namilux/core";
import { Card, DescList, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

const STALE_MS = 2 * 60 * 1000;

export function SystemHealth({ jobs, lastBackupAt, workerHeartbeatAt, revalidateQueue }: { jobs: { failed: number; dead: number; queued: number }; lastBackupAt: string | null; workerHeartbeatAt: string | null; revalidateQueue: number }) {
  const workerOk = workerHeartbeatAt !== null && Date.now() - new Date(workerHeartbeatAt).getTime() < STALE_MS;
  const failed = jobs.failed + jobs.dead;
  return (
    <Card
      title={fa["nav.system"]}
      actions={
        <Link href="/system/health" className="ui-link-btn">
          {fa["dash.details"]}
        </Link>
      }
    >
      <DescList
        items={[
          {
            label: fa["dash.worker"],
            value: (
              <span className="inline-flex items-center gap-2">
                {workerHeartbeatAt !== null ? <span className="text-xs text-ink-3">{formatRelative(workerHeartbeatAt)}</span> : null}
                <StatusBadge tone={workerOk ? "ok" : "warn"}>{workerOk ? fa["health.ok"] : fa["dash.stale"]}</StatusBadge>
              </span>
            ),
          },
          {
            label: fa["dash.jobs"],
            value: (
              <Link href="/system/jobs?status=dead" className="inline-flex items-center gap-2">
                <span className="text-xs text-ink-3">
                  {faInt(jobs.queued)} {fa["health.jobs"]}
                </span>
                <StatusBadge tone={failed > 0 ? "danger" : "ok"}>{faInt(failed)}</StatusBadge>
              </Link>
            ),
          },
          { label: fa["dash.backup"], value: lastBackupAt === null ? <span className="text-ink-3">{fa["dash.backup.unknown"]}</span> : formatJalali(lastBackupAt, "short") },
          { label: fa["nav.cache"], value: faInt(revalidateQueue) },
        ]}
      />
    </Card>
  );
}
