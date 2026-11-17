import { DiagnosticCopy } from "@/components/DiagnosticCopy";
import { faInt, formatJalali, formatRelative } from "@namilux/core";
import { Card, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

export type HealthData = {
  db: { ok: boolean; role: string; ms: number };
  jobs: { queued: number; running: number; failed: number; dead: number; oldestQueuedSec: number };
  workerHeartbeatAt: string | null;
  lastBackupAt: string | null;
  mediaDir: { path: string; ok: boolean };
  contract: { ok?: boolean; runAt?: string; total?: number; covered?: number; missing?: number } | null;
  version: string;
};

export function HealthPanel({ data }: { data: HealthData }) {
  const workerOk = data.workerHeartbeatAt !== null && Date.now() - new Date(data.workerHeartbeatAt).getTime() < 120_000;
  const rows: { label: string; ok: boolean; text: string }[] = [
    { label: fa["health.db"], ok: data.db.ok, text: `${faInt(data.db.ms)} میلی‌ثانیه` },
    { label: fa["health.worker"], ok: workerOk, text: data.workerHeartbeatAt === null ? fa["common.none"] : formatRelative(data.workerHeartbeatAt) },
    { label: fa["health.jobs"], ok: data.jobs.dead === 0, text: `در صف: ${faInt(data.jobs.queued)}، در حال انجام: ${faInt(data.jobs.running)}، ناموفق: ${faInt(data.jobs.failed)}، متوقف: ${faInt(data.jobs.dead)}` },
    { label: fa["health.media"], ok: data.mediaDir.ok, text: data.mediaDir.ok ? "فایل‌ها در دسترس هستند" : "فایل‌ها در دسترس نیستند؛ با پشتیبانی تماس بگیرید" },
    { label: fa["health.backup"], ok: data.lastBackupAt !== null, text: data.lastBackupAt === null ? fa["common.none"] : formatJalali(data.lastBackupAt, "short") },
    {
      label: fa["health.contract"],
      ok: data.contract?.ok === true,
      text: data.contract === null ? fa["common.none"] : `${faInt(data.contract.covered ?? 0)} / ${faInt(data.contract.total ?? 0)}${data.contract.runAt !== undefined ? ` · ${formatJalali(data.contract.runAt, "short")}` : ""}`,
    },
  ];
  return (
    <Card>
      <dl className="grid gap-2 text-sm md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-0 flex-col gap-2 border-b border-[var(--line)] py-2 sm:flex-row sm:items-center sm:justify-between">
            <dt className="shrink-0 text-[var(--ink-2)]">{r.label}</dt>
            <dd className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 text-xs [overflow-wrap:anywhere]">{r.text}</span>
              <StatusBadge tone={r.ok ? "ok" : "warn"}>{r.ok ? fa["health.ok"] : fa["health.warn"]}</StatusBadge>
            </dd>
          </div>
        ))}
      </dl>
      <DiagnosticCopy data={data} />
    </Card>
  );
}
