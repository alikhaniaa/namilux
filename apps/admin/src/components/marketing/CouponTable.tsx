"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Coupon } from "@namilux/core/client";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import { EmptyRow, StatusBadge, Table, Td, Th } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function couponValue(c: Pick<Coupon, "kind" | "value">): string {
  if (c.kind === "percent") return `${faInt(c.value)}٪`;
  if (c.kind === "fixed") return formatToman(c.value);
  return fa["coupons.kind.free_shipping"];
}

export function CouponTable({ items }: { items: Coupon[] }) {
  const router = useRouter();
  async function toggle(c: Coupon): Promise<void> {
    try {
      await api(`/api/coupons/${String(c.id)}`, { method: "POST", body: { active: !c.isActive } });
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }
  return (
    <Table minWidth={760}>
      <thead>
        <tr>
          <Th>{fa["coupons.code"]}</Th>
          <Th>{fa["coupons.kind"]}</Th>
          <Th>{fa["coupons.minSubtotal"]}</Th>
          <Th>{fa["coupons.window"]}</Th>
          <Th>{fa["coupons.used"]}</Th>
          <Th>{fa["coupons.active"]}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.id} className="border-t border-[var(--line)]">
            <Td ltr>
              <Link href={`/marketing/coupons/${String(c.id)}`} className="font-medium hover:text-[var(--accent)]">
                {c.code}
              </Link>
            </Td>
            <Td>
              {fa[`coupons.kind.${c.kind}`]} · {couponValue(c)}
              {c.firstOrderOnly ? <StatusBadge tone="muted">{fa["coupons.firstOrder"]}</StatusBadge> : null}
              {c.customerId !== null ? <StatusBadge tone="muted">{fa["coupons.personal"]}</StatusBadge> : null}
            </Td>
            <Td>{c.minSubtotal > 0 ? formatToman(c.minSubtotal) : "ثبت نشده"}</Td>
            <Td className="text-xs text-[var(--ink-2)]">
              {c.startsAt !== null ? formatJalali(c.startsAt, "short") : "…"} → {c.endsAt !== null ? formatJalali(c.endsAt, "short") : "…"}
            </Td>
            <Td className="tabular-nums">
              {faInt(c.usedCount)}
              {c.usageLimit !== null ? ` / ${faInt(c.usageLimit)}` : ""}
            </Td>
            <Td>
              <button type="button" onClick={() => void toggle(c)}>
                <StatusBadge tone={c.isActive ? "ok" : "muted"}>{c.isActive ? fa["common.active"] : fa["common.inactive"]}</StatusBadge>
              </button>
            </Td>
          </tr>
        ))}
        {items.length === 0 ? <EmptyRow colSpan={6} text={fa["table.empty"]} /> : null}
      </tbody>
    </Table>
  );
}
