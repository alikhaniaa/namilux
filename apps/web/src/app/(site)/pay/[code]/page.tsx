import { getOrderForCustomer, noindexMeta } from "@namilux/core";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import type { Metadata } from "next";
import { connection } from "next/server";
import { LoginForm } from "@/components/account/LoginForm";
import { OrderActions } from "@/components/account/OrderActions";
import { Bdi } from "@/components/ui/Bdi";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { t } from "@/i18n";

// Reads the session and the order, so it is never prerendered (cacheComponents).
export const instant = false;

export function generateMetadata(): Metadata {
  const meta = noindexMeta(t("pay.title"));
  return { title: meta.title, robots: meta.robots };
}

export default async function PayLinkRoute({ params }: { params: Promise<{ code: string }> }): Promise<React.ReactNode> {
  // Nonce CSP route: block on the request before anything is rendered (see account/layout.tsx).
  await connection();
  const code = decodeURIComponent((await params).code).toUpperCase();
  const user = await currentUser();
  const unit = t("product.price.unit");

  if (user === null) {
    return (
      <section className="wrap section grid max-w-md gap-6">
        <h1 className="d-2">{t("pay.title")}</h1>
        <p className="t-body text-ink-2">{t("pay.login")}</p>
        <LoginForm next={`/pay/${encodeURIComponent(code)}/`} />
      </section>
    );
  }

  const order = await getOrderForCustomer(db, code, user.customerId);
  const paid =
    order !== null && (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered");

  return (
    <section className="wrap section grid max-w-2xl gap-6">
      <header className="grid gap-2">
        <h1 className="d-2">{t("pay.title")}</h1>
        {order === null ? (
          <p className="t-body text-ink-2">{t("pay.notFound")}</p>
        ) : paid ? (
          <p className="t-body text-ink-2">{t("pay.paid")}</p>
        ) : order.canRetryPayment ? (
          <p className="t-body text-ink-2">{t("pay.body", { code: order.code })}</p>
        ) : (
          <p className="t-body text-ink-2">{t("pay.closed")}</p>
        )}
      </header>

      {order !== null ? (
        <>
          <ul className="grid gap-2 t-sm">
            {order.items.map((it) => (
              <li key={it.id} className="hairline-t flex items-center justify-between gap-3 py-2">
                <span>
                  <Bdi text={it.name} /> <span className="text-ink-3">×{faInt(it.qty)}</span>
                </span>
                <span className="tnum">
                  {formatToman(it.lineTotal)} {unit}
                </span>
              </li>
            ))}
          </ul>
          <p className="d-3">
            {formatToman(order.grandTotal)} <span className="t-sm text-ink-2">{unit}</span>
          </p>
          {order.status === "pending_payment" && order.expiresAt !== null ? (
            <p className="t-xs text-ink-3">{t("pay.expiresAt", { time: formatJalali(order.expiresAt, "short") })}</p>
          ) : null}
          <OrderActions
            code={order.code}
            canCancel={false}
            canReturn={false}
            canRetryPayment={order.canRetryPayment}
            payLabel={t("checkout.pay", { amount: formatToman(order.grandTotal) })}
          />
        </>
      ) : null}
    </section>
  );
}
