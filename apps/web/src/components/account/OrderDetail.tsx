import type { CustomerOrderView } from "@namilux/core";
import { faDigits, formatJalali, formatToman, mediaUrl } from "@namilux/core/client";
import Link from "next/link";
import { OrderActions } from "./OrderActions";
import { OrderTimeline } from "./OrderTimeline";
import { ORDER_STATUS_KEY } from "./order-status";
import { Bdi } from "@/components/ui/Bdi";
import { t } from "@/i18n";

function paymentLabel(driver: string, isTest: boolean): string {
  if (isTest) return t("result.test");
  if (driver === "manual") return t("order.payment.manual");
  if (driver === "snapppay") return t("checkout.payment.snapppay");
  return t("checkout.payment.zarinpal");
}

export function OrderDetail({ order }: { order: CustomerOrderView }): React.ReactNode {
  const steps = order.timeline;
  const statusKey = ORDER_STATUS_KEY[order.status];
  const unit = t("product.price.unit");
  const a = order.address;
  const invoiceReady = order.invoiceNo !== null;

  return (
    <article className="grid gap-8">
      <header className="grid gap-1">
        <p className="t-xs text-ink-3">{formatJalali(order.placedAt, "long")}</p>
        <h2 className="d-3">
          <Bdi text={order.code} />
        </h2>
        <p className="t-sm text-ink-2">{t(statusKey)}</p>
      </header>

      <OrderTimeline steps={steps} />

      <OrderActions code={order.code} canCancel={order.canCancel} canReturn={order.canReturn} canRetryPayment={order.canRetryPayment} />
      {order.cancelViaSupport ? (
        <p className="t-caption text-ink-2">
          {t("order.cancel.snapppay")} <a className="link-under" href="/contact-us/">{t("order.cancel.snapppay.cta")}</a>
        </p>
      ) : null}

      <section className="grid gap-3">
        <h3 className="t-sm font-semibold">{t("order.items")}</h3>
        <ul className="grid gap-3">
          {order.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3">
              <span className="plate block h-[100px] w-[80px] shrink-0 overflow-hidden">
                {it.imageKey !== null ? (
                  // An order line snapshots a storage key, not an ImageRef, so there are no
                  // renditions for ui/Img to choose from; the master is served as-is.
                  <img src={mediaUrl(it.imageKey)} alt="" className="h-full w-full object-contain mix-blend-multiply" loading="lazy" />
                ) : null}
              </span>
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="t-body font-semibold">
                  <Bdi text={it.name} />
                </span>
                {it.colorName !== null ? (
                  <span className="t-xs text-ink-3">
                    {t("product.color")}: {it.colorName}
                  </span>
                ) : null}
                <span className="t-xs text-ink-3">{t("cart.line.unit", { price: formatToman(it.unitPrice), qty: it.qty })}</span>
              </span>
              <span className="price price--sm">
                {formatToman(it.lineTotal)}
                <span className="price-unit">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="grid gap-2">
          <h3 className="t-sm font-semibold">{t("order.address")}</h3>
          <p className="t-body">
            {a.recipientName}، <bdi>{faDigits(a.recipientPhone)}</bdi>
          </p>
          <p className="t-body text-ink-2">
            {a.province} · {a.city} · {a.address}
            {a.plaque !== null ? ` · ${a.plaque}` : ""}
            {a.unit !== null ? ` · ${a.unit}` : ""}
          </p>
          <p className="t-xs text-ink-3">
            {t("checkout.address.postcode")}: <bdi>{faDigits(a.postcode)}</bdi>
          </p>
          <p className="t-xs text-ink-3">
            {t("order.shipping")}: {order.shipping.name}
          </p>
        </section>
        <section className="grid gap-2">
          <h3 className="t-sm font-semibold">{t("order.payment")}</h3>
          {order.payment === null ? (
            <p className="t-body text-ink-2">{t("order.payment.none")}</p>
          ) : (
            <>
              <p className="t-body">{paymentLabel(order.payment.driver, order.isTest)}</p>
              {order.payment.refId !== null ? (
                <p className="t-xs text-ink-3">
                  {t("order.payment.ref")}: <bdi dir="ltr">{faDigits(order.payment.refId)}</bdi>
                </p>
              ) : null}
              {order.payment.cardPanMasked !== null ? (
                <p className="t-xs text-ink-3">
                  {t("order.payment.card")}: <bdi dir="ltr">{faDigits(order.payment.cardPanMasked)}</bdi>
                </p>
              ) : null}
            </>
          )}
          {invoiceReady ? (
            <Link className="link-under t-sm" href={`/account/orders/${encodeURIComponent(order.code)}/invoice/`}>
              {t("order.invoice")}
            </Link>
          ) : null}
        </section>
      </div>

      <section className="grid max-w-md gap-2 t-sm">
        <div className="flex justify-between">
          <span className="text-ink-2">{t("cart.summary.subtotal")}</span>
          <span>
            {formatToman(order.subtotal)} {unit}
          </span>
        </div>
        {order.discountTotal > 0 ? (
          <div className="flex justify-between">
            <span className="text-ink-2">{t("cart.summary.discount")}</span>
            <span>
              −{formatToman(order.discountTotal)} {unit}
            </span>
          </div>
        ) : null}
        {order.pointsDiscount > 0 ? (
          <div className="flex justify-between">
            <span className="text-ink-2">{t("cart.summary.points")}</span>
            <span>
              −{formatToman(order.pointsDiscount)} {unit}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-ink-2">{t("cart.summary.shipping")}</span>
          <span>{order.shippingTotal === 0 ? t("cart.summary.free") : `${formatToman(order.shippingTotal)} ${unit}`}</span>
        </div>
        <div className="hairline-t flex justify-between pt-2 font-semibold">
          <span>{t("cart.summary.total")}</span>
          <span>
            {formatToman(order.grandTotal)} {unit}
          </span>
        </div>
      </section>

      {order.customerNote !== null && order.customerNote !== "" ? (
        <section className="grid gap-1">
          <h3 className="t-sm font-semibold">{t("order.note")}</h3>
          <p className="t-body text-ink-2">{order.customerNote}</p>
        </section>
      ) : null}
      {order.isGift && order.giftMessage !== null ? (
        <section className="grid gap-1">
          <h3 className="t-sm font-semibold">{t("order.gift")}</h3>
          <p className="t-body text-ink-2">{order.giftMessage}</p>
        </section>
      ) : null}
    </article>
  );
}
