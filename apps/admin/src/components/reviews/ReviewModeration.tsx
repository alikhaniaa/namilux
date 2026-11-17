"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Review } from "@namilux/core/client";
import { faInt, formatRelative } from "@namilux/core/client";
import { Button, EmptyState, StatusBadge, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function ReviewModeration({ items }: { items: (Review & { productName: string })[] }) {
  const router = useRouter();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function moderate(id: string, status: "approved" | "rejected"): Promise<void> {
    setBusy(id);
    try {
      const text = (reply[id] ?? "").trim();
      await api(`/api/reviews/${id}`, { method: "PUT", body: { status, ...(text === "" ? {} : { reply: text }) } });
      toast(fa["reviews.moderated"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <EmptyState text={fa["inbox.empty"]} />;
  return (
    <ul className="divide-y divide-[var(--line)] border border-[var(--line)]">
      {items.map((r) => (
        <li key={r.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.productName}</span>
              <span className="text-xs text-[var(--ink-2)]">{r.customerDisplayName}</span>
              <span className="text-xs tabular-nums">★ {faInt(r.rating)}</span>
              {r.isVerifiedPurchase ? <StatusBadge tone="ok">{fa["reviews.verified"]}</StatusBadge> : null}
              <StatusBadge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "warn" : "default"}>{fa[`reviews.status.${r.status}`]}</StatusBadge>
            </div>
            <span className="text-xs text-[var(--ink-2)]">{formatRelative(r.createdAt)}</span>
          </div>
          {r.title !== "" ? <p className="font-medium">{r.title}</p> : null}
          <p className="whitespace-pre-wrap text-[var(--ink-2)]">{r.body}</p>
          {r.pros.length > 0 ? <p className="text-xs text-[var(--ok)]">+ {r.pros.join("، ")}</p> : null}
          {r.cons.length > 0 ? <p className="text-xs text-[var(--danger)]">− {r.cons.join("، ")}</p> : null}
          {r.adminReply !== null ? <p className="border-s-2 border-[var(--line-strong)] ps-2 text-xs">{r.adminReply}</p> : null}
          {r.status === "pending" ? (
            <div className="space-y-2">
              <Textarea rows={2} placeholder={fa["reviews.replyLabel"]} value={reply[r.id] ?? ""} onChange={(e) => setReply((p) => ({ ...p, [r.id]: e.target.value }))} />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === r.id} onClick={() => void moderate(r.id, "approved")}>
                  {fa["reviews.approve"]}
                </Button>
                <Button size="sm" variant="danger" disabled={busy === r.id} onClick={() => void moderate(r.id, "rejected")}>
                  {fa["reviews.reject"]}
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
