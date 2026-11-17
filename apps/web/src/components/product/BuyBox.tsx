"use client";
import { faInt, imgSrc, productUrl } from "@namilux/core/client";
import type { ProductDetail } from "@namilux/core/client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cartStore } from "@/components/state/cart-store";
import { toast } from "@/components/state/toast-store";
import { Bdi } from "@/components/ui/Bdi";
import { Button, ButtonCoin, ButtonLabel } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StockLine } from "@/components/ui/StockLine";
import { t } from "@/i18n";
import dynamic from "next/dynamic";
import { DeliveryEstimator } from "./DeliveryEstimator";
import { PriceGroup } from "./PriceGroup";
import { QtyStepper } from "./QtyStepper";
import { ShareButton } from "./ShareButton";
import { SwatchRow } from "./SwatchRow";
import { TrustList } from "./TrustList";
import { CompareButton } from "./CompareButton";
import { WishlistButton } from "./WishlistButton";
import { shopPhones } from "@/components/shell/contact";

// DECISION (perf): the two sheets are loaded on first open, not with the page. They are the only
// PDP islands that import zod schemas, and a static import put the whole zod runtime (64 KB gz)
// into every product page's first-load JS; a sheet nobody has opened yet needs no code at all.
const ConciergeSheet = dynamic(() => import("./ConciergeSheet").then((m) => m.ConciergeSheet), { ssr: false });
const BackInStockSheet = dynamic(() => import("./BackInStockSheet").then((m) => m.BackInStockSheet), { ssr: false });

/** the spec - the button says «افزوده شد» for a beat, then goes back to its label. */
const CONFIRM_MS = 1400;

export type PdpSheet = "concierge" | "stock" | null;
type PdpState = { productId: number; qty: number; sheet: PdpSheet };

/**
 * DECISION: the "small context" the StickyBuyBar spec asks for is a module-scoped store read with
 * useSyncExternalStore, not a React context. The PDP renders BuyBox and StickyBuyBar as sibling
 * islands of a server page, so no provider in either file can wrap the other without editing
 * app/product/[slug]/page.tsx - another file's contract. This is the same pattern as
 * components/state/* and gives the two bars one source of truth for the quantity and for which
 * sheet is open.
 */
let pdp: PdpState = { productId: 0, qty: 1, sheet: null };
const pdpListeners = new Set<() => void>();

function emitPdp(next: PdpState): void {
  pdp = next;
  for (const cb of pdpListeners) cb();
}

function subscribePdp(cb: () => void): () => void {
  pdpListeners.add(cb);
  return () => {
    pdpListeners.delete(cb);
  };
}

export const pdpBuy = {
  subscribe: subscribePdp,
  /** 1 until the buy box of *this* product has mounted, so a qty from the previous PDP never leaks. */
  qtyOf(productId: number): number {
    return pdp.productId === productId ? pdp.qty : 1;
  },
  sheetOf(productId: number): PdpSheet {
    return pdp.productId === productId ? pdp.sheet : null;
  },
  setQty(productId: number, qty: number): void {
    emitPdp({ productId, qty, sheet: pdp.productId === productId ? pdp.sheet : null });
  },
  open(productId: number, sheet: Exclude<PdpSheet, null>): void {
    emitPdp({ productId, qty: pdp.productId === productId ? pdp.qty : 1, sheet });
  },
  close(): void {
    emitPdp({ ...pdp, sheet: null });
  },
  reset(productId: number): void {
    if (pdp.productId === productId) return;
    emitPdp({ productId, qty: 1, sheet: null });
  },
};

/** The quantity both bars edit. */
export function usePdpQty(productId: number): { qty: number; setQty: (n: number) => void } {
  const qty = useSyncExternalStore(
    subscribePdp,
    () => pdpBuy.qtyOf(productId),
    () => 1,
  );
  const setQty = useCallback(
    (n: number) => {
      pdpBuy.setQty(productId, n);
    },
    [productId],
  );
  return { qty, setQty };
}

export function BuyBox({
  product,
  whatsappHref,
  contact,
  warrantyMonths,
  storeAvailable,
  gateway = "zarinpal",
}: {
  product: ProductDetail;
  whatsappHref: string;
  contact: { phoneLand: string; phoneMobile: string };
  warrantyMonths: number | null;
  storeAvailable: boolean;
  /** The site's gateway, named in the trust list (the instalment site never mentions ZarinPal). */
  gateway?: "zarinpal" | "snapppay";
}): React.ReactNode {
  const { qty, setQty } = usePdpQty(product.id);
  const sheet = useSyncExternalStore(
    subscribePdp,
    () => pdpBuy.sheetOf(product.id),
    () => null,
  );
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    pdpBuy.reset(product.id);
  }, [product.id]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const buyable = !product.onRequest && product.available;
  const phones = shopPhones(contact);
  const phoneHref = phones[0]?.href ?? "";
  const thumb = product.image === undefined ? undefined : imgSrc(product.image, 112);
  const label = [product.brand?.nameEn, product.modelCode].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  const category = product.categories[product.categories.length - 1];
  const url = productUrl(product.slug);
  const hasColours = product.variants.length > 0 || product.colorName !== undefined;

  const add = (): void => {
    // Never a client-side price: the store keeps ids and quantities only, and the cart re-quotes.
    cartStore.add(product.id, qty);
    setAdded(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setAdded(false);
    }, CONFIRM_MS);
    // DECISION: the toast action uses `toast.viewCart` («مشاهدهٔ سبد»), the copy the spec asks
    // for; product/QuickAdd reaches for `cart.title` («سبد خرید») for the same action, which is a
    // second label for one action (v2 §10.2) - the key named after the action wins here.
    toast.show({
      key: "toast.added",
      ...(thumb === undefined ? {} : { image: thumb }),
      action: { key: "toast.viewCart", href: "/cart/" },
    });
  };

  const copyCode = (): void => {
    if (product.sku === null) return;
    void navigator.clipboard.writeText(product.sku).then(
      () => {
        toast.show({ key: "product.codeCopied" });
      },
      () => {
        // Clipboard denied (an insecure context or a permission): nothing to announce.
      },
    );
  };

  const colours = hasColours ? (
    <div className="grid gap-2">
      <p className="t-sm text-ink-2">
        {t("product.color")}
        {product.colorName === undefined ? null : <span className="text-ink">{` · ${product.colorName}`}</span>}
      </p>
      <SwatchRow variants={product.variants} selectedId={product.id} mode="pdp" />
    </div>
  ) : null;

  return (
    <div className="buybox">
      <div className="buybox__head">
        {label.length === 0 ? null : (
          <span className="label">
            {label.map((part, i) => (
              <span key={part}>
                {i > 0 ? " · " : null}
                <bdi>{part}</bdi>
              </span>
            ))}
          </span>
        )}
        <h1 className="d-2">
          <Bdi text={product.displayName} />
        </h1>
        <div className="buybox__meta">
          {category === undefined ? null : (
            <Link href={category.href} className="link-under">
              {category.name}
            </Link>
          )}
          {product.rating !== undefined && product.rating.count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-gilt">
                <Icon name="star" size={16} />
              </span>
              {t("product.reviews.avg", { n: product.rating.avg })}
              <span aria-hidden="true"> · </span>
              {t("product.reviews.count", { n: product.rating.count })}
            </span>
          ) : null}
          {product.sku === null ? null : (
            <span className="text-ink-4">
              <bdi>{product.sku}</bdi>
            </span>
          )}
        </div>
      </div>

      {product.onRequest ? (
        // 283 of 541 products have no price: the concierge is a PRIMARY path, never a disabled buy
        // button.
        <>
          <div className="pdp-offer">
            <p className="d-3">{t("product.onRequest.title")}</p>
            <p className="t-body text-ink-2">{t("product.onRequest.body")}</p>
            {colours === null ? null : <div className="pdp-offer__colors">{colours}</div>}
          </div>
          {/* The sticky bar watches this element: once it leaves the viewport the bar takes over. */}
          <div data-pdp-cta className="pdp-actions">
            <div className="pdp-actions__row">
              <Button
                variant="primary"
                size="lg"
                icon="chat"
                onClick={() => {
                  pdpBuy.open(product.id, "concierge");
                }}
              >
                {t("product.concierge")}
              </Button>
            </div>
            <div className="pdp-actions__quiet">
              {phoneHref === "" ? null : (
                <a href={phoneHref} className="btn btn--quiet">
                  <ButtonLabel>{t("product.call")}</ButtonLabel>
                  <ButtonCoin icon="phone" />
                </a>
              )}
              {product.sku === null ? null : (
                <Button variant="quiet" onClick={copyCode}>
                  {t("product.copyCode")}
                </Button>
              )}
              <WishlistButton productId={product.id} variant="button" />
              <CompareButton productId={product.id} />
              <ShareButton title={product.displayName} url={url} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="pdp-offer">
            <div className="pdp-offer__row">
              <PriceGroup price={product.price} compareAt={product.compareAt ?? null} />
              {/* DECISION: ProductDetail carries no stock quantity on purpose, and
                  StockLine's «فقط n عدد باقی مانده» needs a real n - inventing n = 1 out of `lowStock`
                  would be a scarcity claim we cannot back (v2 §9.3: only when true). The PDP therefore
                  shows the plain in/out line and the «آخرین» badge carries the scarcity signal. */}
              <StockLine available={product.available ? 1 : 0} lowStock={false} backorder={product.allowBackorder} />
            </div>
            {colours === null ? null : <div className="pdp-offer__colors">{colours}</div>}
          </div>

          <div data-pdp-cta className="pdp-actions">
            <div className="pdp-actions__row">
              {buyable ? (
                <>
                  <QtyStepper
                    value={qty}
                    onChange={setQty}
                    maxPerOrder={product.maxPerOrder}
                    // The storefront is never told how many are left; `available` is the boolean, so
                    // the product's own cap is the only real bound here.
                    available={product.maxPerOrder}
                  />
                  <Button variant="primary" size="lg" icon={added ? "check" : "bag"} className={added ? "btn--did" : ""} onClick={add}>
                    {added ? t("product.added") : t("product.addToCart")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  icon="chat"
                  onClick={() => {
                    pdpBuy.open(product.id, "stock");
                  }}
                >
                  {t("product.notify")}
                </Button>
              )}
            </div>
            {/* Secondary intents sit under the buy row so the primary action never wraps. */}
            <div className="pdp-actions__quiet">
              <WishlistButton productId={product.id} variant="button" />
              <CompareButton productId={product.id} />
              <ShareButton title={product.displayName} url={url} />
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-4 t-sm">
        {phones.map((phone) => <a key={phone.href} href={phone.href} className="link-under"><bdi dir="ltr">{phone.display}</bdi></a>)}
      </div>
      {whatsappHref === "" ? null : (
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn--secondary btn--block">
          <ButtonLabel>{t("product.whatsapp")}</ButtonLabel>
          <ButtonCoin icon="whatsapp" />
        </a>
      )}

      <div className="pdp-assure">
        <p className="pdp-assure__title">{t("product.assurance")}</p>
        {/* DECISION: mounted without shipping methods - this component's contract carries none, and
            the estimator falls back to the free_nationwide bands of the spec until the page threads
            `settings.shipping` through. It stays the PDP's one home for «ارسال رایگان». */}
        <DeliveryEstimator methods={[]} />
        <TrustList warrantyMonths={warrantyMonths} storeAvailable={storeAvailable} gateway={gateway} paymentRow={true} />
        {product.maxPerOrder > 0 && product.maxPerOrder < 5 ? (
          <p className="t-xs text-ink-3">{t("product.qty.max", { n: faInt(product.maxPerOrder) })}</p>
        ) : null}
      </div>

      {sheet === "concierge" ? (
        <ConciergeSheet
          open
          onClose={() => {
            pdpBuy.close();
          }}
          product={{ id: product.id, displayName: product.displayName, sku: product.sku, url }}
          whatsappHref={whatsappHref}
          phoneHref={phoneHref}
          promise={t("product.onRequest.body")}
        />
      ) : null}
      {sheet === "stock" ? (
        <BackInStockSheet
          open
          onClose={() => {
            pdpBuy.close();
          }}
          productId={product.id}
          name={product.displayName}
        />
      ) : null}
    </div>
  );
}
