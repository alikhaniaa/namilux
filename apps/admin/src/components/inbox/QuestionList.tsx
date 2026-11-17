"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Question } from "@namilux/core/client";
import { formatRelative } from "@namilux/core/client";
import { ReplyComposer } from "./ReplyComposer";
import { Button, EmptyState, StatusBadge } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function QuestionList({ items }: { items: (Question & { productName: string | null })[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);

  async function hide(id: string): Promise<void> {
    try {
      await api(`/api/inbox/${id}/reply`, { method: "POST", body: { kind: "question", hide: true } });
      toast(fa["common.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  if (items.length === 0) return <EmptyState text={fa["inbox.empty"]} />;
  return (
    <ul className="divide-y divide-[var(--line)] border border-[var(--line)]">
      {items.map((q) => (
        <li key={q.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{q.productName ?? fa["common.none"]}</span>
              <span className="ltr text-xs text-[var(--ink-2)]">{q.phoneMasked}</span>
              <StatusBadge tone={q.status === "answered" ? "ok" : q.status === "hidden" ? "muted" : "default"}>{fa[`inbox.status.${q.status}`]}</StatusBadge>
              {q.channel === "instalments" ? <StatusBadge tone="warn">{fa["inbox.channel.instalments"]}</StatusBadge> : null}
            </div>
            <span className="text-xs text-[var(--ink-2)]">{formatRelative(q.createdAt)}</span>
          </div>
          <p>{q.body}</p>
          {q.answer !== null ? <p className="border-s-2 border-[var(--line-strong)] ps-2 text-xs">{q.answer}</p> : null}
          {q.status === "pending" ? (
            open === q.id ? (
              <ReplyComposer id={q.id} kind="question" allowFaq onDone={() => { setOpen(null); router.refresh(); }} />
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(q.id)}>
                  {fa["inbox.reply"]}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void hide(q.id)}>
                  {fa["inbox.hide"]}
                </Button>
              </div>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
