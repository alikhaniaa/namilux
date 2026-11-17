import { statusLabel } from "@/i18n/admin-labels";
import Link from "next/link";
import { faInt, formatJalali, formatToman } from "@namilux/core";
import type { SmsLogRow } from "@namilux/core";
import { EmptyRow, Kpi, StatusBadge, Table, Td, Th } from "@/components/kit";
import { fa, smsTemplateLabel } from "@/i18n/fa";

export function SmsLogTable({ items, spend }: { items: SmsLogRow[]; spend: { sent: number; failed: number; costToman: number; otpSends: number } }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={fa["smsLog.spend.today"]} value={formatToman(spend.costToman)} hint={fa["form.toman"]} />
        <Kpi label={fa["smsLog.sent"]} value={faInt(spend.sent)} />
        <Kpi label={fa["smsLog.failed"]} value={faInt(spend.failed)} tone={spend.failed > 0 ? "warn" : "default"} />
        <Kpi label={fa["smsLog.otp"]} value={faInt(spend.otpSends)} />
      </div>
      <Table minWidth={720}>
        <thead>
          <tr>
            <Th>{fa["smsLog.to"]}</Th>
            <Th>{fa["smsLog.template"]}</Th>
            <Th>{fa["smsLog.provider"]}</Th>
            <Th>{fa["common.status"]}</Th>
            <Th>{fa["smsLog.cost"]}</Th>
            <Th>{fa["orders.code"]}</Th>
            <Th>{fa["common.date"]}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-t border-[var(--line)]">
              <Td ltr className="text-xs">
                {r.toMasked}
              </Td>
              <Td ltr className="text-xs">
                {smsTemplateLabel(r.template)}
              </Td>
              <Td ltr className="text-xs">
                {({ farazsms: "فراز پیامک", kavenegar: "کاوه‌نگار", melipayamak: "ملی پیامک", smsir: "سامانهٔ پیامک", mock: "آزمایشی" })[r.provider] ?? "سامانهٔ پیامک"}
              </Td>
              <Td>
                <StatusBadge tone={r.status === "failed" ? "warn" : r.status === "sent" ? "ok" : "default"}>{statusLabel(r.status)}</StatusBadge>
                {r.error !== null ? <span className="ms-2 text-xs text-[var(--danger)]">ارسال انجام نشد. وضعیت سامانهٔ پیامک را با پشتیبانی بررسی کنید.</span> : null}
              </Td>
              <Td className="tabular-nums">{r.cost === null ? fa["common.none"] : formatToman(r.cost)}</Td>
              <Td ltr className="text-xs">
                {r.orderId !== null ? <Link href={`/orders?q=${r.orderId}`}>مشاهدهٔ سفارش</Link> : fa["common.none"]}
              </Td>
              <Td className="text-xs text-[var(--ink-2)]">{formatJalali(r.createdAt, "short")}</Td>
            </tr>
          ))}
          {items.length === 0 ? <EmptyRow colSpan={7} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
    </div>
  );
}
