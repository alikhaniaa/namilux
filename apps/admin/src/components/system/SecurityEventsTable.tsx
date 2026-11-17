import { DiagnosticCopy } from "@/components/DiagnosticCopy";
import { securityLabel } from "@/i18n/admin-labels";
import { formatJalali } from "@namilux/core";
import type { SecurityEvent } from "@namilux/core";
import { EmptyRow, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function SecurityEventsTable({ items }: { items: SecurityEvent[] }) {
  return (
    <Table minWidth={720}>
      <thead>
        <tr>
          <Th>{fa["security.kind"]}</Th>
          <Th>{fa["security.ip"]}</Th>
          <Th>{fa["security.actor"]}</Th>
          <Th>{fa["security.detail"]}</Th>
          <Th>{fa["common.date"]}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((e) => (
          <tr key={e.id} className="border-t border-[var(--line)] align-top">
            <Td>
              <StatusBadge tone={/failed|locked|forged|rejected|breaker/.test(e.kind) ? "warn" : "default"}>{securityLabel(e.kind)}</StatusBadge>
            </Td>
            <Td ltr className="text-xs">
              {e.ip ?? fa["common.none"]}
            </Td>
            <Td ltr className="text-xs">
              {e.actor === null ? "سامانه" : "کاربر ثبت‌شده"}
            </Td>
            <Td>
              <DiagnosticCopy data={{ id: e.id, kind: e.kind, actor: e.actor, detail: e.detail }} />
            </Td>
            <Td className="text-xs text-[var(--ink-2)]">{formatJalali(e.createdAt, "short")}</Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
