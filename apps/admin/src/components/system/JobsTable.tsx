"use client";
import { DiagnosticCopy } from "@/components/DiagnosticCopy";
import { jobLabel, statusLabel } from "@/i18n/admin-labels";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt, formatJalali } from "@namilux/core/client";
import type { Job } from "@namilux/core/client";
import { Button, EmptyRow, StatusBadge, Table, Td, Th } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function JobsTable({ items }: { items: Job[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(id: string): Promise<void> {
    setBusy(id);
    try {
      await api(`/api/jobs/${id}/retry`, { method: "POST" });
      toast(fa["jobs.retried"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Table minWidth={760}>
      <thead>
        <tr>
          <Th>{fa["jobs.type"]}</Th>
          <Th>{fa["common.status"]}</Th>
          <Th>{fa["jobs.attempts"]}</Th>
          <Th>{fa["jobs.runAt"]}</Th>
          <Th>{fa["jobs.error"]}</Th>
          <Th>{fa["common.actions"]}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((j) => (
          <tr key={j.id} className="border-t border-[var(--line)] align-top">
            <Td>
              <button type="button" className="text-start hover:text-[var(--accent)]" onClick={() => setOpen(open === j.id ? null : j.id)}>
                {jobLabel(j.type)}
              </button>
              {open === j.id ? <DiagnosticCopy data={{ id: j.id, type: j.type, payload: j.payload, error: j.lastError }} /> : null}
            </Td>
            <Td>
              <StatusBadge tone={j.status === "dead" || j.status === "failed" ? "warn" : j.status === "done" ? "muted" : "default"}>{statusLabel(j.status)}</StatusBadge>
            </Td>
            <Td>
              {faInt(j.attempts)}/{faInt(j.maxAttempts)}
            </Td>
            <Td className="text-xs text-[var(--ink-2)]">{formatJalali(j.runAt, "short")}</Td>
            <Td className="max-w-xs text-xs text-[var(--danger)]">{j.lastError ? "انجام نشد. دوباره تلاش کنید؛ اگر مشکل ادامه داشت، گزارش را برای پشتیبانی بفرستید." : ""}</Td>
            <Td>
              {j.status === "dead" || j.status === "failed" ? (
                <Button size="sm" variant="outline" disabled={busy === j.id} onClick={() => void retry(j.id)}>
                  {fa["jobs.retry"]}
                </Button>
              ) : null}
            </Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={6} text={fa["table.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
