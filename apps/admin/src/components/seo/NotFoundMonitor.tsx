"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt, formatRelative } from "@namilux/core/client";
import { Button, EmptyRow, Input, Table, Td, Th } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function NotFoundMonitor({ items }: { items: { path: string; hits: number; referrers: string[]; lastAt: string }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function create(path: string): Promise<void> {
    const to = (target[path] ?? "/shop/").trim();
    setBusy(path);
    try {
      await api("/api/seo/redirects", { method: "POST", body: { fromPath: path, toPath: to, code: 301 } });
      toast(fa["redirects.saved"]);
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
          <Th>{fa["notfound.path"]}</Th>
          <Th>{fa["notfound.hits"]}</Th>
          <Th>{fa["notfound.referrers"]}</Th>
          <Th>{fa["notfound.last"]}</Th>
          <Th>{fa["notfound.create"]}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.path} className="border-t border-[var(--line)] align-top">
            <Td ltr className="text-xs">
              {r.path}
            </Td>
            <Td className="tabular-nums">{faInt(r.hits)}</Td>
            <Td>
              <ul className="ltr text-[11px] text-[var(--ink-2)]">
                {r.referrers.slice(0, 3).map((ref) => (
                  <li key={ref} className="truncate">
                    {ref}
                  </li>
                ))}
              </ul>
            </Td>
            <Td className="text-xs text-[var(--ink-2)]">{formatRelative(r.lastAt)}</Td>
            <Td>
              <span className="flex gap-1">
                <Input dir="ltr" className="h-7 w-44 text-xs" value={target[r.path] ?? "/shop/"} onChange={(e) => setTarget((t) => ({ ...t, [r.path]: e.target.value }))} />
                <Button size="sm" variant="outline" disabled={busy === r.path} onClick={() => void create(r.path)}>
                  {fa["notfound.create"]}
                </Button>
              </span>
            </Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
