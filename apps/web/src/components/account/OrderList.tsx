import type { CustomerOrderRow } from "@namilux/core/client";
import { formatJalali, formatToman } from "@namilux/core/client";
import Link from "next/link";
import { ORDER_STATUS_KEY } from "./order-status";
import { Bdi } from "@/components/ui/Bdi";
import { t } from "@/i18n";
import { Icon } from "@/components/ui/Icon";

const PAGE_SIZE = 20;

function tone(status: CustomerOrderRow["status"]): string {
  if (status === "cancelled" || status === "failed" || status === "expired" || status === "refunded" || status === "returned") return "text-danger";
  if (status === "delivered" || status === "paid" || status === "shipped" || status === "processing") return "text-ok";
  return "text-ink-2";
}

export function OrderList({ orders, page, total }: { orders: CustomerOrderRow[]; page: number; total: number }): React.ReactNode {
  const hasPrev = page > 1;
  const hasNext = page * PAGE_SIZE < total;
  return (
    <div className="grid gap-5">
      <ul className="grid gap-3">
        {orders.map((o) => {
          const statusKey = ORDER_STATUS_KEY[o.status];
          return (
            <li key={o.id}>
              <Link href={`/account/orders/${encodeURIComponent(o.code)}/`} className="account-order">
                <span className="account-order__icon"><Icon name="bag" size={24} /></span>
                <span className="grid gap-1">
                  <span className="t-body font-semibold">
                    <Bdi text={o.code} />
                  </span>
                  <span className="account-order__meta">
                    {formatJalali(o.placedAt, "long")} · {t("order.itemsCount", { n: o.itemsCount })}
                  </span>
                </span>
                <span className="grid justify-items-end gap-1">
                  <span className="price price--sm">
                    {formatToman(o.grandTotal)}
                    <span className="price-unit">{t("product.price.unit")}</span>
                  </span>
                  <span className={`account-order__status ${tone(o.status)}`}>{t(statusKey)}</span>
                </span>
                <Icon name="chevron-e" size={20} />
              </Link>
            </li>
          );
        })}
      </ul>
      {hasPrev || hasNext ? (
        <nav className="flex items-center justify-between t-sm" aria-label={t("account.orders")}>
          {hasPrev ? (
            <Link className="link-under" href={`/account/orders/?page=${String(page - 1)}`}>
              {t("order.page.prev")}
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link className="link-under" href={`/account/orders/?page=${String(page + 1)}`}>
              {t("order.page.next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
