import type { ProductCard as ProductCardData } from "@namilux/core/client";
import { ProductCard } from "@/components/product/ProductCard";
import { Rail } from "@/components/ui/Rail";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function RelatedRail({
  title,
  display = false,
  items,
  href,
  priority = false,
}: {
  title: FaKey;
  display?: boolean;
  items: ProductCardData[];
  href?: string;
  /**
   * DECISION: an extra prop, not in the header's props list. When this rail is the first image on
   * the page its leading card IS the LCP element, and a lazy LCP image cost the homepage 1.2 s
   * (Lighthouse: "Largest Contentful Paint image was lazily loaded", LCP 3.2 s against a 2.0 s
   * budget). Only the first card is promoted, and only when the caller says the rail paints first.
   */
  priority?: boolean;
}): React.ReactNode {
  // An empty rail is worse than no rail: it spends a section's vertical budget saying nothing.
  if (items.length === 0) return null;
  return (
    <section className="section grid gap-4">
      <div className="wrap">
        <SectionHeader display={display} title={t(title)} {...(href === undefined ? {} : { href })} as="h2" />
      </div>
      <Rail ariaLabel={t(title)} itemWidth="card">
        {items.map((product, i) => (
          <li key={product.id}>
            {/* compact: no quick-add inside a rail - the rail is for discovery, the grid is for buying. */}
            <ProductCard product={product} compact priority={priority && i === 0} />
          </li>
        ))}
      </Rail>
    </section>
  );
}
