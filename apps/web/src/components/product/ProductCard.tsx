"use client";
import { imgSrc, productUrl } from "@namilux/core/client";
import type { ProductCard as ProductCardData } from "@namilux/core/client";
import Link from "next/link";
import { useState } from "react";
import { QuickAdd } from "./QuickAdd";
import { SwatchRow } from "./SwatchRow";
import { WishlistButton } from "./WishlistButton";
import { Badge } from "@/components/ui/Badge";
import { Bdi } from "@/components/ui/Bdi";
import { Img } from "@/components/ui/Img";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";

export function ProductCard({
  product,
  priority = false,
  compact = false,
}: {
  product: ProductCardData;
  priority?: boolean;
  compact?: boolean;
}): React.ReactNode {
  // F-012: tapping a swatch previews that finish in place; the link still goes to the product the
  // card is for, so a preview can never navigate somewhere the shopper did not choose.
  const [previewId, setPreviewId] = useState(product.id);
  const preview = product.variants.find((v) => v.productId === previewId);
  const image = preview?.image ?? product.image;
  const href = productUrl(product.slug);

  return (
    <article className="card">
      <div
        className={`plate${product.available ? "" : " is-out"}`}
        // §11: the tile is the same element as the PDP gallery across the navigation.
        style={{ viewTransitionName: `p-${String(product.id)}` }}
      >
        <Link href={href} tabIndex={-1} aria-hidden="true">
          {image === undefined ? (
            // DECISION: no photograph → the plate stays the product ground, but it names
            // the product quietly (brand + model code, plate ink) so a row of photo-less legacy items
            // does not read as a broken grid. It is text, not a placeholder image or a logo.
            <span className="plate-empty">
              <span className="plate-empty__brand">{product.brand === null ? "" : product.brand.name}</span>
              {product.modelCode === undefined ? null : <span className="plate-empty__model">{product.modelCode}</span>}
              {/* Design audit 2 Sep 2026: the name is the tile's only content - it is drawn, not hidden. */}
              <span className="plate-empty__name">
                <Bdi text={product.displayName} />
              </span>
            </span>
          ) : (
            <>
              <Img image={image} slot="tile" alt="" priority={priority} />
              {/* §7.3: a second photograph cross-fades in under a real pointer; it is never fetched
                  eagerly (lazy) and adds nothing on touch screens. */}
              {product.images2 === undefined || previewId !== product.id ? null : (
                <span className="plate__alt" aria-hidden="true">
                  <Img image={product.images2} slot="tile" alt="" />
                </span>
              )}
            </>
          )}
        </Link>
        <WishlistButton productId={product.id} variant="chip" />
        {/* Badges take the top inline-start corner (the heart has the top inline-end; the quick-add bar owns the foot). */}
        {product.badges.length === 0 ? null : (
          <div className="absolute top-2 start-2 z-10 flex gap-1">
            {product.badges.map((b) => (
              <Badge key={b.kind} kind={b} />
            ))}
          </div>
        )}
        {/* UI v4: quick-add lives on the plate - a glass bar under a real pointer, a bag chip on
            touch (components.css `.card .cta`) - so the card body is name and price alone. */}
        {compact ? null : (
          <div className="cta">
            <QuickAdd
              productId={product.id}
              available={product.available}
              onRequest={product.onRequest}
              instalmentOff={product.instalmentEligible === false}
              {...(image === undefined ? {} : { image: imgSrc(image, 112) })}
            />
          </div>
        )}
      </div>

      <div className="body">
        {/* Brand and model on one meta line; the model is a Latin run and must be isolated. */}
        <p className="brand">
          {product.brand === null ? null : product.brand.name}
          {product.brand !== null && product.modelCode !== undefined ? " · " : null}
          {product.modelCode === undefined ? null : <Bdi text={product.modelCode} />}
        </p>

        <h3 className="name">
          <Link href={href}>
            <Bdi text={product.displayName} />
          </Link>
        </h3>

        {/* UI v4.1: a quiet fact line - how many finishes, and whether it ships now. */}
        <p className="meta">
          {product.onRequest ? null : product.available ? (
            <span className="dot dot--ok">{t("plp.avail.ready")}</span>
          ) : (
            <span className="dot">{t("product.stock.out")}</span>
          )}
          {product.variants.length >= 2 ? <span>{t("product.colors.count", { n: product.variants.length })}</span> : null}
        </p>

        {/* Reserved whether or not there are variants (the spec anatomy). */}
        <div className="swatches">
          <SwatchRow variants={product.variants} selectedId={previewId} mode="card" onPreview={setPreviewId} />
        </div>

        <div className="prices">
          {product.onRequest ? (
            <p className="t-sm text-ink-2">{t(product.instalmentEligible === false ? "product.instalmentOff" : "product.onRequest")}</p>
          ) : (
            <Price amount={product.price} compareAt={product.compareAt ?? null} size="sm" />
          )}
        </div>
      </div>
    </article>
  );
}
