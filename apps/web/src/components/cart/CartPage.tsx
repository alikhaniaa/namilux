"use client";
import { ROUTES, type ProductCard } from "@namilux/core/client";
import { t } from "@/i18n";
import { useCart } from "@/components/state/cart-store";
import { useWishlist } from "@/components/state/wishlist-store";
import { EmptyState } from "@/components/ui/EmptyState";
import { CartLine } from "./CartLine";
import { CrossSell } from "./CrossSell";
import { FreeShippingProgress } from "./FreeShippingProgress";
import { OrderSummary } from "./OrderSummary";
import { UnavailableLines } from "./UnavailableLines";
import { useQuote } from "./useQuote";

export function CartPage({ crossSellIds, bestsellers }: { crossSellIds: number[]; bestsellers: ProductCard[] }): React.ReactNode {
  const { lines, setQty, remove } = useCart();
  const { toggle } = useWishlist();
  const { quote, removed, dropped, error, refresh } = useQuote({});
  const droppedNote = dropped.length === 0 ? null : (
    <p role="status" className="panel ps-4 pe-4 pt-3 pb-3 t-body text-ink-2">{t("cart.dropped", { names: dropped.join("»، «") })}</p>
  );

  if (lines.length === 0) {
    return (
      <>
      {droppedNote}
      <EmptyState
        title="cart.empty.title"
        body="cart.empty.body"
        headingLevel={2}
        primary={{ key: "nav.shop", href: ROUTES.shop }}
        rail={{ title: "cart.empty.rail", items: bestsellers }}
        texture="pampas"
      />
      </>
    );
  }

  const activeLines = quote?.lines.filter((l) => l.status !== "removed") ?? [];
  const saveForLater = (id: number): void => {
    toggle(id);
    remove(id);
  };

  return (
    // Design audit 2 Sep 2026: one measured column of lines beside a sticky summary (components.css `.cart`).
    <div className="cart">
      <div className="grid gap-6">
        {error !== null ? <div role="alert" className="grid gap-3 border border-line p-4"><p>{t("checkout.error.generic")}</p><button type="button" className="btn btn--secondary" onClick={refresh}>{t("error.retry")}</button></div> : null}
        {quote === null && error === null ? <div role="status" className="grid gap-3 py-6"><span className="skeleton h-24 w-full" /><p className="t-sm text-ink-3">{t("cart.updating")}</p></div> : null}
        {droppedNote}
        {activeLines.length === 0 ? null : (
          <div className="cart__lines">
            {activeLines.map((l) => (
              <CartLine key={l.productId} line={l} onQty={(q) => setQty(l.productId, q)} onRemove={() => remove(l.productId)} onSaveForLater={() => saveForLater(l.productId)} />
            ))}
          </div>
        )}
        <UnavailableLines lines={removed} warnings={quote?.warnings ?? []} onWishlist={saveForLater} onRemove={remove} />
      </div>
      <aside className="cart__aside">
        <FreeShippingProgress subtotal={quote?.subtotal ?? 0} freeAbove={null} />
        <OrderSummary quote={quote} cta={{ label: "cart.checkout", href: ROUTES.billing }} />
      </aside>
      {crossSellIds.length === 0 ? null : <div className="cart__recommendations">
        <CrossSell ids={crossSellIds} />
      </div>}
    </div>
  );
}
