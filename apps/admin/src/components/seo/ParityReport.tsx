"use client";
import { useState } from "react";
import { faInt, formatJalali } from "@namilux/core/client";
import { Button, Card, StatusBadge } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type ParityData = {
  contract: { ok?: boolean; runAt?: string; total?: number; covered?: number; missing?: number } | null;
  lastRun: { runId: string; at: string; paths: number; non200: number; missingTitle: number } | null;
};

export function ParityReport({ data }: { data: ParityData }) {
  const [busy, setBusy] = useState(false);
  async function run(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/seo/parity", { method: "POST", body: {} });
      toast(fa["seo.parity.queued"]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title={fa["seo.parity"]}>
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-[var(--ink-2)]">{fa["health.contract"]}</dt>
        <dd>
          {data.contract === null ? (
            fa["seo.parity.none"]
          ) : (
            <>
              <StatusBadge tone={data.contract.ok === true ? "ok" : "warn"}>
                {faInt(data.contract.covered ?? 0)} / {faInt(data.contract.total ?? 0)}
              </StatusBadge>
              {data.contract.runAt !== undefined ? <span className="ms-2 text-xs text-[var(--ink-2)]">{formatJalali(data.contract.runAt, "short")}</span> : null}
            </>
          )}
        </dd>
        <dt className="text-[var(--ink-2)]">{fa["seo.parity"]}</dt>
        <dd>
          {data.lastRun === null ? (
            fa["seo.parity.none"]
          ) : (
            <>
              <span className="tabular-nums">{faInt(data.lastRun.paths)}</span>
              <span className="ms-2 text-xs text-[var(--ink-2)]">
                {fa["seo.parity.diffs"].replace("{n}", faInt(data.lastRun.non200 + data.lastRun.missingTitle))} · {formatJalali(data.lastRun.at, "short")}
              </span>
            </>
          )}
        </dd>
      </dl>
      <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {fa["seo.parity.run"]}
      </Button>
    </Card>
  );
}
