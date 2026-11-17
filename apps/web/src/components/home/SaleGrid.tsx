import { ROUTES } from "@namilux/core/client";
import type { ProductCard as ProductCardData } from "@namilux/core/client";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { t } from "@/i18n";

// §9.1: two columns on a phone, three from md up - and three on wide screens too, because the
// module is six cards, not a listing. --cols only overrides the ≥1180 step of .vitrine.
const COLS = { "--cols": "3" } as React.CSSProperties;

export function SaleGrid({ items }: { items: ProductCardData[] }): React.ReactNode {
  // EDGE CASE: nothing on sale → render nothing (getHomeData returns [] and the section vanishes).
  if (items.length === 0) return null;

  return (
    <section className="wrap section below-fold grid gap-4">
      <div>
        <SectionHeader display title={t("home.sale.title")} href={ROUTES.discount} />
      </div>
      {/* DECISION: the cards are laid out here rather than through plp/ProductGrid, which marks its
          first four images `priority`. That is right on a PLP, where the grid is the LCP element,
          and wrong under the hero - the hero is the home page's one priority image. */}
      <ul className="vitrine" style={COLS}>
        {items.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
