import type { ProductCard as ProductCardData } from "@namilux/core/client";
import { ProductCard } from "@/components/product/ProductCard";
import { t } from "@/i18n";

// The first row is the LCP candidate on a phone, so those images are eager and high priority;
// everything below is lazy.
const PRIORITY_COUNT = 4;

export function ProductGrid({
  items,
  density,
  ariaBusy = false,
}: {
  items: ProductCardData[];
  density?: 3 | 5;
  ariaBusy?: boolean;
}): React.ReactNode {
  return (
    <>
      {/* DECISION: a visually hidden <h2> above the grid. Every product name is an <h3> (correct in
          a rail, which sits under a SectionHeader <h2>), so on a PLP - where the only other heading
          is the page <h1> - the cards skipped a level and axe reported heading-order. The listing
          is a real section of the page and deserves a name; it just has no room for one visually. */}
      <h2 className="sr-only">{t("plp.results")}</h2>
      <ul
      className="vitrine"
      aria-busy={ariaBusy || undefined}
      // the spec: 2 / 3 / 4 columns by breakpoint; the density toggle only overrides the ≥1180 step.
      style={density === undefined ? undefined : ({ "--cols": String(density) } as React.CSSProperties)}
    >
      {items.map((product, i) => (
        <li key={product.id}>
          <ProductCard product={product} priority={i < PRIORITY_COUNT} />
        </li>
      ))}
      </ul>
    </>
  );
}
