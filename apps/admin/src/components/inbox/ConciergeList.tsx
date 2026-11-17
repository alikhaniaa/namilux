"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConciergeRequest } from "@namilux/core/client";
import { formatRelative, maskPhone } from "@namilux/core/client";
import { ReplyComposer } from "./ReplyComposer";
import { Button, EmptyState, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function ConciergeList({ items }: { items: ConciergeRequest[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return <EmptyState text={fa["inbox.empty"]} />;
  return (
    <ul className="divide-y divide-[var(--line)] border border-[var(--line)]">
      {items.map((r) => (
        <li key={r.id} className="space-y-2 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/product/${encodeURIComponent(r.productSlug)}/`} className="font-medium hover:text-[var(--accent)]">
                {r.productName}
              </Link>
              <span className="ltr text-xs text-[var(--ink-2)]">{maskPhone(r.phone)}</span>
              <StatusBadge tone={r.status === "answered" ? "ok" : r.status === "hidden" ? "muted" : "default"}>{fa[`inbox.status.${r.status}`]}</StatusBadge>
              {r.channel === "instalments" ? <StatusBadge tone="warn">{fa["inbox.channel.instalments"]}</StatusBadge> : null}
            </div>
            <span className="text-xs text-[var(--ink-2)]">{formatRelative(r.createdAt)}</span>
          </div>
          {r.body !== "" ? <p className="text-[var(--ink-2)]">{r.body}</p> : null}
          {r.channel === "instalments" && r.status === "pending" ? <p className="text-xs text-[var(--ink-2)]">{fa["inbox.channel.instalmentsHint"]}</p> : null}
          {r.answer !== null ? <p className="border-s-2 border-[var(--line-strong)] ps-2 text-xs">{r.answer}</p> : null}
          {r.status === "pending" ? (
            open === r.id ? (
              <ReplyComposer id={r.id} kind="concierge" phone={r.phone} allowPrice={r.channel !== "instalments"} onDone={() => { setOpen(null); router.refresh(); }} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>
                {fa["inbox.reply"]}
              </Button>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
