import { existsSync } from "node:fs";
import Link from "next/link";
import { dashboard, faInt, getSettings, jobs, snapppayAttention } from "@namilux/core";
import { paymentDrivers } from "@namilux/integrations";
import { pingDb } from "@namilux/db";
import { HealthPanel } from "@/components/system/HealthPanel";
import { Card, PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/env";

export default async function HealthPage() {
  await requirePermission("system.jobs");
  const started = Date.now();
  const ping = await pingDb(db).catch(() => null);
  const [stats, dash, settings, snappAttention] = await Promise.all([
    jobs.stats(db).catch(() => null),
    dashboard(db, "today", { now: new Date(), smsDailyBudget: 0 }).catch(() => null),
    getSettings(db).catch(() => null),
    snapppayAttention(db).catch(() => 0),
  ]);
  const snappConfigured = paymentDrivers(env).configured("snapppay");
  const mediaDir = process.env.MEDIA_DIR ?? "";
  const contract = settings === null ? null : (settings["system.contract"] as { ok?: boolean; runAt?: string; total?: number; covered?: number; missing?: number });
  return (
    <div className="max-w-3xl">
      <PageHeader title={fa["nav.health"]} />
      <HealthPanel
        data={{
          db: ping === null ? { ok: false, role: "ثبت نشده", ms: Date.now() - started } : { ok: ping.ok, role: ping.role, ms: ping.ms },
          jobs: { queued: stats?.queued ?? 0, running: stats?.running ?? 0, failed: stats?.failed ?? 0, dead: stats?.dead ?? 0, oldestQueuedSec: stats?.oldestQueuedSec ?? 0 },
          workerHeartbeatAt: dash?.workerHeartbeatAt ?? null,
          lastBackupAt: dash?.lastBackupAt ?? null,
          mediaDir: { path: mediaDir, ok: mediaDir !== "" && existsSync(/* turbopackIgnore: true */ mediaDir) },
          contract,
          version: process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
        }}
      />
      {/* Read-only: switching SnappPay on or off is a server setting the technical team changes. */}
      <Card title="درگاه اقساطی اسنپ‌پی" className="mt-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-[var(--ink-2)]">نمایش در صفحهٔ پرداخت</dt>
          <dd>{env.SNAPPPAY_ENABLED ? <StatusBadge tone="ok">روشن</StatusBadge> : <StatusBadge tone="muted">خاموش</StatusBadge>}</dd>
          <dt className="text-[var(--ink-2)]">اطلاعات اتصال</dt>
          <dd>{snappConfigured ? <StatusBadge tone="ok">ثبت شده</StatusBadge> : <StatusBadge tone="danger">ثبت نشده</StatusBadge>}</dd>
          <dt className="text-[var(--ink-2)]">سفارش‌های نیازمند پیگیری</dt>
          <dd>
            {snappAttention > 0 ? (
              <Link href="/orders?method=snapppay&attention=1" className="text-[var(--danger)] underline">{faInt(snappAttention)} سفارش</Link>
            ) : (
              <StatusBadge tone="ok">هیچ</StatusBadge>
            )}
          </dd>
        </dl>
        <p className="mt-3 text-xs text-[var(--ink-3)]">
          روشن یا خاموش کردن اسنپ‌پی و تغییر نشانی سرور از طرف تیم فنی انجام می‌شود. اگر نشانی (IP) سرور عوض شود، باید از راه پشتیبانی اسنپ‌پی ثبت شود.
        </p>
      </Card>
    </div>
  );
}
