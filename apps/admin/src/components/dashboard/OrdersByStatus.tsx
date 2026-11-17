import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { faInt } from "@namilux/core";
import type { OrderStatus } from "@namilux/core";
import { statusTone } from "@/components/orders/status-tone";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

/** The statuses someone has to act on come first; the settled ones follow when they have orders. */
const ACTION: OrderStatus[] = ["paid", "processing", "pending_payment", "shipped"];
const SETTLED: OrderStatus[] = ["delivered", "cancelled", "refunded", "returned", "expired", "failed"];

export function OrdersByStatus({ counts }: { counts: Partial<Record<OrderStatus, number>> }) {
  const rows = [...ACTION, ...SETTLED.filter((s) => (counts[s] ?? 0) > 0)];
  return (
    <Card
      title={fa["dash.orders"]}
      description={fa["dash.orders.hint"]}
      actions={
        <Link href="/orders" className="ui-link-btn">
          {fa["dash.viewAll"]}
        </Link>
      }
    >
      <ul className="stat-list">
        {rows.map((s) => {
          const n = counts[s] ?? 0;
          return (
            <li key={s}>
              <Link href={`/orders?status=${s}`} className="stat-list__row" data-strong={ACTION.includes(s) && n > 0 ? "" : undefined}>
                <span className={`stat-dot stat-dot--${statusTone(s)}`} aria-hidden="true" />
                <span className="stat-list__label">{fa[`orders.status.${s}`]}</span>
                <b>{faInt(n)}</b>
                <ChevronLeft size={15} aria-hidden="true" className="stat-list__go" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
