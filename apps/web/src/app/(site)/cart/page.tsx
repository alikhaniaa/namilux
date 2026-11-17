import { isShowcaseCard, noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import { connection } from "next/server";
import { CartPage } from "@/components/cart/CartPage";
import { t } from "@/i18n";
import { loadPlp } from "@/server/loaders/catalog";

export function generateMetadata(): Metadata {
  const meta = noindexMeta(t("cart.title"));
  return { title: meta.title, robots: meta.robots };
}

/**
 * DECISION (4 Sep 2026, performance review): /cart/ is under the nonce CSP (proxy.ts). A prerendered
 * shell bakes a nonce that never matches the request's header, so the browser blocks every script
 * and the cart island never renders. Block on the request instead of shipping a shell (the page is
 * `no-store`); the cross-sell rail is still one cached loader call. See account/layout.tsx.
 */
export const instant = false;

export default async function CartRoute(): Promise<React.ReactNode> {
  await connection();
  const bestsellers = await loadPlp({ scope: { kind: "all" }, sort: "bestselling", avail: ["in"] });
  // Design audit 2 Sep 2026: the way out of an empty cart is photographed, buyable products only.
  const rail = bestsellers.items.filter(isShowcaseCard).slice(0, 8);
  return (
    <div className="wrap section cart-page">
      <h1 className="d-2 text-ink mb-6">{t("cart.title")}</h1>
      <CartPage crossSellIds={[]} bestsellers={rail} />
    </div>
  );
}
