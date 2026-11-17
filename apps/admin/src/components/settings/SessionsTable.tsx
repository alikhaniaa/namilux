"use client";
import { useRouter } from "next/navigation";
import { formatJalali } from "@namilux/core/client";
import { EmptyRow, StatusBadge, Table, Td, Th } from "@/components/kit";
import { ConfirmButton, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type SessionRowLite = { id: string; createdAt: string; lastSeenAt: string; ip: string | null; ua: string | null; current: boolean };

// `revokeUrl` is a template with a literal `{id}` - a string, not a function: this is a client component
// and the staff page that renders it is a server component (3 Sep 2026 walkthrough: passing a function
// crashed /settings/staff/[id] with "Functions cannot be passed directly to Client Components").
export function SessionsTable({ items, revokeUrl, onRevoked }: { items: SessionRowLite[]; revokeUrl: string; onRevoked?: () => Promise<void> }) {
  const router = useRouter();
  async function revoke(id: string): Promise<void> {
    try {
      await api(revokeUrl.replace("{id}", encodeURIComponent(id)), { method: "DELETE" });
      toast(fa["sessions.revoked"]);
      await onRevoked?.();
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }
  return (
    <Table minWidth={640}>
      <thead>
        <tr>
          <Th>{fa["sessions.created"]}</Th>
          <Th>{fa["sessions.lastSeen"]}</Th>
          <Th>{fa["sessions.ip"]}</Th>
          <Th>دستگاه</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.id} className="border-t border-[var(--line)]">
            <Td className="text-xs">{formatJalali(s.createdAt, "short")}</Td>
            <Td className="text-xs">{formatJalali(s.lastSeenAt, "short")}</Td>
            <Td ltr className="text-xs">
              {s.ip ?? "ثبت نشده"}
            </Td>
            <Td ltr className="max-w-xs truncate text-[11px] text-[var(--ink-2)]">
              {s.ua === null ? "ثبت نشده" : /mobile|android|iphone/i.test(s.ua) ? "گوشی همراه" : /ipad|tablet/i.test(s.ua) ? "تبلت" : "رایانه"}
            </Td>
            <Td>{s.current ? <StatusBadge tone="ok">{fa["sessions.current"]}</StatusBadge> : <ConfirmButton label={fa["sessions.revoke"]} confirmLabel="این دستگاه از حساب خارج شود؟" variant="ghost" onConfirm={() => revoke(s.id)} />}</Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
