import { ROUTES, plpUrl } from "@namilux/core/client";
import type { ProductCard } from "@namilux/core/client";
import { RelatedRail } from "@/components/product/RelatedRail";

// The «همه» link is minted by the PLP url grammar, never hand-written, so the filtered listing the
// rail promises is byte-identical to the one a facet chip would produce.
const ALL_HREF = plpUrl(ROUTES.shop, { avail: ["ready"] });

export function ReadyRail({ items }: { items: ProductCard[] }): React.ReactNode {
  // EDGE CASE: no buyable priced products → render nothing; an empty rail spends a section's
  // vertical budget saying nothing.
  if (items.length === 0) return null;
  // DECISION: the leading card is `priority`. Module 1's hero is a banner the merchant may not have
  // set - with no hero this rail is the first image on the page, so its first card is the LCP
  // element, and Lighthouse measured it being lazily loaded. Promoting exactly one image costs a
  // single eager request and nothing when a hero does exist above it.
  return (
    <div className="below-fold">
      {/* v2 §9.2: this is the first product module of the page - the serial-position slot the rail
          of eight ready-to-ship items was chosen for. RelatedRail is the DECIDED shape of
          "SectionHeader + Rail of compact cards", so it is composed rather than rebuilt. */}
      <RelatedRail display title="home.ready.title" items={items} href={ALL_HREF} priority />
    </div>
  );
}
