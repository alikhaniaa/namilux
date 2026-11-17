"use client";
import { useEffect, useState } from "react";
import { cartStore } from "@/components/state/cart-store";
import { toast } from "@/components/state/toast-store";
import { Bdi } from "@/components/ui/Bdi";
import { Button } from "@/components/ui/Button";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";
import { pdpBuy, usePdpQty } from "./BuyBox";
import { QtyStepper } from "./QtyStepper";

/**
 * The element the bar watches. BuyBox marks its CTA row with this attribute (both directions of the
 * contract live in these two files); no marker on the page means no bar, never a crash.
 */
const CTA_SELECTOR = "[data-pdp-cta]";

export function StickyBuyBar({
  productId,
  name,
  price,
  image,
  available,
  onRequest,
  instalmentOff = false,
  maxPerOrder,
}: {
  productId: number;
  name: string;
  price: number;
  image: string | null;
  available: boolean;
  onRequest: boolean;
  /** Instalment site only: the product is switched off for instalments (it arrives as onRequest). */
  instalmentOff?: boolean;
  maxPerOrder: number;
}): React.ReactNode {
  const { qty, setQty } = usePdpQty(productId);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const cta = document.querySelector(CTA_SELECTOR);
    if (cta === null) return undefined;
    // DECISION: "once the CTA *leaves* the viewport" is read literally - the bar waits until the
    // real buy button has been seen at least once. Otherwise it would already be up at the top of
    // the page, competing with the gallery for the first screen the shopper ever sees.
    let seen = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry === undefined) return;
        if (entry.isIntersecting) {
          seen = true;
          setPassed(false);
        } else if (seen) {
          setPassed(true);
        }
      },
      { threshold: 0 },
    );
    observer.observe(cta);
    return () => {
      observer.disconnect();
    };
  }, [productId]);

  // DECISION: hidden means unmounted, not `visibility: hidden` - a bar the reader cannot see must
  // not be a stop in the tab order either, and being fixed it costs no layout when it returns.
  if (!passed) return null;

  return (
    // The one fixed bottom element of a PDP: the tab bar hides itself on /product/*.
    <div className="buybar anim-sheet safe-b">
      <div className="wrap buybar__inner">
        <div className="buybar__product">
          {image === null ? null : (
            <span className="plate buybar__thumb">
              <img src={image} alt="" />
            </span>
          )}
          <span className="min-w-0 grow">
            {/* Names clamp to two lines and are never cut to one. */}
            <Bdi text={name} className="buybar__name line-clamp-2" />
            {onRequest ? <span className="t-xs text-ink-3">{t(instalmentOff ? "product.instalmentOff" : "product.onRequest")}</span> : <Price amount={price} size="sm" />}
          </span>
        </div>
        <div className="buybar__actions">
          {onRequest ? (
            <Button
              variant="primary"
              icon="chat"
              onClick={() => {
                pdpBuy.open(productId, "concierge");
              }}
            >
              {t("product.concierge")}
            </Button>
          ) : available ? (
            <>
              {/* The same quantity the buy box shows - one number, two places to change it. */}
              <QtyStepper value={qty} onChange={setQty} maxPerOrder={maxPerOrder} available={maxPerOrder} />
              <Button
                variant="primary"
                icon="bag"
                onClick={() => {
                  cartStore.add(productId, qty);
                  toast.show({
                    key: "toast.added",
                    ...(image === null ? {} : { image }),
                    action: { key: "toast.viewCart", href: "/cart/" },
                  });
                }}
              >
                {t("product.addToCart")}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              icon="chat"
              onClick={() => {
                pdpBuy.open(productId, "stock");
              }}
            >
              {t("product.notify")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
