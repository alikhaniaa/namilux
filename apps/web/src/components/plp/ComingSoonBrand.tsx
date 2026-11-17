// DECISION: the file carries "use client" - the header's CTA opens a Sheet, and the open/closed
// state of a sheet cannot live in a server component. The band itself is static markup, so the
// island is a button plus a boolean.
"use client";
import { ROUTES, plpUrl } from "@namilux/core/client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";
// DECISION (4 Sep 2026, performance review): loaded on demand, like BuyBox does. The sheet's form
// validates with the shared zod schema, and a static import put the whole zod runtime (63 KB gz)
// into the eager bundle of EVERY listing page - for a band that only the coming-soon brands show.
const BackInStockSheet = dynamic(() => import("@/components/product/BackInStockSheet").then((m) => m.BackInStockSheet), { ssr: false });

export function ComingSoonBrand({
  brand,
  product,
}: {
  brand: { name: string; nameEn: string; claim: string | null };
  // DECISION (added, optional): the header's own resolution is "subscribes to the brand's first
  // restock … uses the brand's most-requested product", but `backInStock.request(db, productId, …)`
  // and `POST /api/products/:id/back-in-stock` both need a product id and the props carry none.
  // The caller (PlpPage) already has the brand's listing, so it passes the first card; without one
  // there is nothing to subscribe to and the CTA falls back to a real link. Logged in
  // the spec.
  product?: { id: number; name: string };
}): React.ReactNode {
  const [open, setOpen] = useState(false);

  return (
    // The graphite chapter is the same frame the home brand chapters use.
    <section className="frame chapter">
      <div className="wrap grid justify-items-start gap-4">
        {brand.nameEn === "" ? null : <p className="label text-frame-ink-2">{brand.nameEn}</p>}
        <h2 className="d-2">{t("plp.comingSoon.title")}</h2>
        {brand.claim === null || brand.claim === "" ? null : (
          <p className="t-lead text-frame-ink-2">{brand.claim}</p>
        )}
        <p className="t-body max-w-[46ch] text-frame-ink-2">
          {t("plp.comingSoon.body", { brand: brand.name })}
        </p>

        {product === undefined ? (
          // Nothing to notify about yet: point at what IS ready to ship rather than at a dead form.
          <Button variant="secondary" href={plpUrl(ROUTES.shop, { avail: ["ready"] })}>
            {t("plp.avail.ready")}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(true);
              }}
            >
              {t("product.notify")}
            </Button>
            <BackInStockSheet
              open={open}
              onClose={() => {
                setOpen(false);
              }}
              productId={product.id}
              name={product.name}
            />
          </>
        )}
      </div>
    </section>
  );
}
