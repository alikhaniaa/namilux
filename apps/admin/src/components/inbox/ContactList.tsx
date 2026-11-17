"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Question } from "@namilux/core/client";
import { formatRelative } from "@namilux/core/client";
import { ReplyComposer } from "./ReplyComposer";
import { Button, EmptyState, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function ContactList({ items }: { items: Question[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return <EmptyState text={fa["inbox.empty"]} />;
  return (
    <ul className="divide-y divide-[var(--line)] border border-[var(--line)]">
      {items.map((m) => (
        <li key={m.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="ltr text-xs text-[var(--ink-2)]">{m.phoneMasked}</span>
              <StatusBadge tone={m.status === "answered" ? "ok" : "default"}>{fa[`inbox.status.${m.status}`]}</StatusBadge>
              {m.channel === "instalments" ? <StatusBadge tone="warn">{fa["inbox.channel.instalments"]}</StatusBadge> : null}
            </div>
            <span className="text-xs text-[var(--ink-2)]">{formatRelative(m.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap">{m.body}</p>
          {m.answer !== null ? <p className="border-s-2 border-[var(--line-strong)] ps-2 text-xs">{m.answer}</p> : null}
          {m.status === "pending" ? (
            open === m.id ? (
              <ReplyComposer id={m.id} kind="contact" onDone={() => { setOpen(null); router.refresh(); }} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setOpen(m.id)}>
                {fa["inbox.reply"]}
              </Button>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
