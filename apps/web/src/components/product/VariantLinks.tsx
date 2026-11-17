import type { ProductCard } from "@namilux/core/client";
import { SwatchRow } from "./SwatchRow";
import { t } from "@/i18n";

export function VariantLinks({
  siblings,
  currentId,
}: {
  siblings: ProductCard[];
  currentId: number;
}): React.ReactNode {
  if (siblings.length === 0) return null;

  // the spec: variant grouping is display-only - every colour keeps its own Product node and its
  // own canonical, and there is no model-level URL. So these are real links, visible to a shopper
  // and to a crawler; a hidden <link rel> row would reach neither.
  const variants = siblings.map((s) => ({
    productId: s.id,
    slug: s.slug,
    colorName: s.colorName ?? "",
    colorHex: null,
    swatch: s.image ?? null,
    image: s.image ?? null,
    available: s.available,
    onRequest: s.onRequest,
  }));

  return (
    <section className="grid gap-2">
      <h2 className="label-fa text-ink-3">{t("product.variants")}</h2>
      <SwatchRow variants={variants} selectedId={currentId} mode="pdp" />
    </section>
  );
}
