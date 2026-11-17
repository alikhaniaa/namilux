import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDetail, can, faDigits, faInt, formatJalali, formatToman } from "@namilux/core";
import { OrderDetail } from "@/components/orders/OrderDetail";
import { statusTone } from "@/components/orders/status-tone";
import { OrderTimeline } from "@/components/orders/OrderTimeline";
import { MethodChip } from "@/components/orders/MethodChip";
import { SnapppayPanel } from "@/components/orders/SnapppayPanel";
import { Avatar, Card, PageHeader, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { inScope } from "@/lib/scope";
import { db } from "@/lib/db";

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const staff = await requirePermission("orders.read");
  const { code } = await params;
  const order = await adminDetail(db, code.toUpperCase()).catch(() => null);
  // The other storefront's order is, for a staff member confined to one site, an order that does not exist.
  if (order === null || !inScope(staff, order.channel)) notFound();
  const refunded = order.refunds.filter((r) => r.status !== "failed").reduce((s, r) => s + r.amount, 0);
  const paidStates = new Set(["paid", "processing", "shipped", "delivered", "returned"]);
  const refundable = paidStates.has(order.status) ? Math.max(0, order.grandTotal - refunded) : 0;
  const gatewayPaid = order.payments.some((p) => p.status === "succeeded" && p.driver !== "manual");
  // Which gateway actually took the money - on the instalment site that is SnappPay, on the main
  // one ZarinPal, and «دستی» for a payment staff recorded by hand.
  const settled = order.payments.find((p) => p.status === "succeeded") ?? null;
  // The latest attempt's method is the order's method in the header; SnappPay gets its own card.
  const latest = [...order.payments].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const method = settled?.driver ?? latest?.driver ?? null;
  const snapppayPaid = settled?.driver === "snapppay";

  return (
    <div>
      <PageHeader
        title={order.code}
        back={{ href: "/orders", label: fa["nav.orders"] }}
        subtitle={`${formatJalali(order.placedAt, "long")} · ${fa[`orders.source.${order.source}`]}${order.channelRef !== null ? ` · ${order.channelRef}` : ""}`}
        badge={
          <>
            <StatusBadge tone={statusTone(order.status)}>{fa[`orders.status.${order.status}`]}</StatusBadge>
            <MethodChip method={method} large />
            {order.isTest ? <StatusBadge tone="warn">test</StatusBadge> : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={fa["orders.items"]} description={fa["orders.itemsCount"].replace("{n}", faInt(order.items.length))}>
            <ul className="order-lines">
              {order.items.map((it) => (
                <li key={it.id}>
                  <span className="order-lines__name">
                    <Link href={`/products/${String(it.productId)}`} className="hover:text-[var(--accent)]">
                      {it.name}
                    </Link>
                    <small>
                      {it.colorName !== null ? <span>{it.colorName}</span> : null}
                      {it.sku !== null ? <span className="ltr">{it.sku}</span> : null}
                    </small>
                  </span>
                  <span className="order-lines__qty">
                    {faInt(it.qty)} × {formatToman(it.unitPrice)}
                  </span>
                  <b className="order-lines__total">{formatToman(it.lineTotal)}</b>
                </li>
              ))}
            </ul>
            <dl className="order-totals">
              <div className="flex justify-between">
                <dt className="text-[var(--ink-2)]">{fa["orders.totals.subtotal"]}</dt>
                <dd>{formatToman(order.subtotal)}</dd>
              </div>
              {order.discountTotal > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">
                    {fa["orders.totals.discount"]}
                    {order.couponCode !== null ? <span className="ms-1 ltr text-xs">{order.couponCode}</span> : null}
                  </dt>
                  <dd>−{formatToman(order.discountTotal)}</dd>
                </div>
              ) : null}
              {order.pointsDiscount > 0 ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">{fa["orders.totals.points"]}</dt>
                  <dd>−{formatToman(order.pointsDiscount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="text-[var(--ink-2)]">
                  {fa["orders.totals.shipping"]} · {order.shipping.name}
                </dt>
                <dd>{formatToman(order.shippingTotal)}</dd>
              </div>
              <div className="flex justify-between order-totals__grand">
                <dt>{fa["orders.totals.grand"]}</dt>
                <dd>
                  {formatToman(order.grandTotal)} <small>{fa["form.toman"]}</small>
                </dd>
              </div>
              {settled !== null ? (
                <div className="flex justify-between">
                  <dt className="text-[var(--ink-2)]">{fa["orders.paymentDriver"]}</dt>
                  <dd>{fa[`paymentDriver.${settled.driver}`]}</dd>
                </div>
              ) : null}
              {refunded > 0 ? (
                <div className="flex justify-between text-[var(--danger)]">
                  <dt>{fa["orders.refunds"]}</dt>
                  <dd>−{formatToman(refunded)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>
          <Card title={fa["common.actions"]}>
            <OrderDetail
              code={order.code}
              status={order.status}
              phone={order.phone}
              grandTotal={order.grandTotal}
              refundable={refundable}
              gatewayPaid={gatewayPaid}
              snapppayPaid={snapppayPaid}
              items={order.items}
              perms={{ write: can(staff, "orders.write"), refund: can(staff, "orders.refund"), manualPayment: can(staff, "orders.manual_payment"), price: can(staff, "catalog.price") }}
            />
          </Card>
          <Card title={fa["orders.timeline"]}>
            <OrderTimeline code={order.code} events={order.events} payments={order.payments} refunds={order.refunds} shipments={order.shipments} smsLog={order.smsLog} canWrite={can(staff, "orders.write")} />
          </Card>
        </div>
        <div className="space-y-4">
          {order.payments.some((p) => p.driver === "snapppay") ? (
            <Card title="پرداخت اسنپ‌پی" description="خرید اقساطی">
              <SnapppayPanel code={order.code} payments={order.payments} refunds={order.refunds} />
            </Card>
          ) : null}
          <Card title={fa["orders.customer"]}>
            <p className="order-person">
              <Avatar name={order.customer?.name ?? order.address.recipientName} />
              {order.customerId !== null && can(staff, "customers.read") ? (
                <Link href={`/customers/${order.customer?.id ?? order.customerId}`} className="hover:text-[var(--accent)]">
                  {order.customer?.name ?? order.address.recipientName}
                </Link>
              ) : (
                <span>{order.address.recipientName}</span>
              )}
            </p>
            <p className="ltr text-sm text-[var(--ink-2)]">{faDigits(order.phone)}</p>
            {order.email !== null ? <p className="ltr text-xs text-[var(--ink-2)]">{order.email}</p> : null}
            {order.customer !== null ? (
              <p className="mt-1 text-xs text-[var(--ink-2)]">
                {fa[`customers.tier.${order.customer.tier}`]} · {fa["customers.orders"]}: {faInt(order.customer.ordersCount)}
              </p>
            ) : null}
          </Card>
          <Card title={fa["orders.address"]}>
            <p className="text-sm">{order.address.recipientName}</p>
            <p className="ltr text-sm text-[var(--ink-2)]">{faDigits(order.address.recipientPhone)}</p>
            <p className="mt-1 text-sm">
              {order.address.province} · {order.address.city}
            </p>
            <p className="text-sm text-[var(--ink-2)]">{order.address.address}</p>
            <p className="text-xs text-[var(--ink-3)]">{faDigits(order.address.postcode)}</p>
          </Card>
          {order.customerNote !== null && order.customerNote !== "" ? (
            <Card title={fa["orders.customerNote"]}>
              <p className="whitespace-pre-wrap text-sm">{order.customerNote}</p>
            </Card>
          ) : null}
          {order.isGift && order.giftMessage !== null ? (
            <Card title={fa["orders.customerNote"]}>
              <p className="whitespace-pre-wrap text-sm">{order.giftMessage}</p>
            </Card>
          ) : null}
          {order.adminNote !== null && order.adminNote !== "" ? (
            <Card title={fa["orders.adminNote"]}>
              <p className="whitespace-pre-wrap text-sm">{order.adminNote}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
