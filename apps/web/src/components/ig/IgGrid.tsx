import { productUrl } from "@namilux/core/client";
import type { Banner, ProductCard } from "@namilux/core/client";
import Link from "next/link";
import { Img } from "@/components/ui/Img";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";
import { Bdi } from "@/components/ui/Bdi";

export type IgCard = { kind: "product"; product: ProductCard } | { kind: "campaign"; banner: Banner };

// The square framing comes from the system's own `.plate--square` modifier: `components.css` is
// imported unlayered and therefore outranks the utilities (the spec - a recipe must beat a
// stray utility), so a plate's ratio is changed by a plate modifier, never by `aspect-*`.

/** The first row is what an Instagram tap paints first, so those two images are eager. */
const ABOVE_FOLD = 2;

function ProductTile({ product, priority }: { product: ProductCard; priority: boolean }): React.ReactNode {
  return (
    <Link href={productUrl(product.slug)} className="grid">
      <div className="plate plate--square">
        {/* No image → the plate is the empty product ground, never a broken image. */}
        {product.image === undefined ? null : <Img image={product.image} slot="tile" alt="" priority={priority} />}
      </div>
      <div className="body">
        {/* The name is the accessible name of the link, so the image stays decorative. */}
        <h3 className="name">
          <Bdi text={product.displayName} />
        </h3>
        <div className="prices">
          {product.onRequest ? (
            <p className="t-sm text-ink-2">{t("product.onRequest")}</p>
          ) : (
            <Price amount={product.price} compareAt={product.compareAt ?? null} size="sm" />
          )}
        </div>
      </div>
    </Link>
  );
}

function CampaignTile({ banner, priority }: { banner: Banner; priority: boolean }): React.ReactNode {
  // Same rule as the hero: theme "dark" takes the graphite media, everything else the light one - 
  // the visitor's colour scheme never picks the image (it would swap after hydration).
  const media = banner.theme === "dark" ? (banner.mediaDark ?? banner.mediaLight) : banner.mediaLight;
  const inner = (
    <>
      <div className="plate plate--square">
        {media === null ? null : <Img image={media} slot="tile" alt="" priority={priority} />}
      </div>
      <div className="body">
        <h3 className="name">{banner.title}</h3>
        <div className="prices">
          {banner.ctaLabel === null ? null : <p className="t-sm link-under">{banner.ctaLabel}</p>}
        </div>
      </div>
    </>
  );

  // EDGE CASE: a campaign card without a target still says something, but it is not a link - 
  // inventing a destination for it would send the tap somewhere nobody chose.
  if (banner.ctaHref === null || banner.ctaHref === "") return <div className="grid">{inner}</div>;
  return (
    <Link href={banner.ctaHref} className="grid">
      {inner}
    </Link>
  );
}

export function IgGrid({ cards }: { cards: IgCard[] }): React.ReactNode {
  // EDGE CASE: nothing curated yet → render nothing; the page owns whatever stands in for it.
  if (cards.length === 0) return null;

  return (
    // the spec: not one byte comes from instagram.com. These are the first-party renditions the
    // seed imported, and the only thing that leaves for Instagram is a link the shopper taps.
    <ul className="grid grid-cols-2 gap-4">
      {cards.map((card, i) => (
        <li
          key={card.kind === "product" ? `p-${String(card.product.id)}` : `c-${String(card.banner.id)}`}
          className="card"
        >
          {card.kind === "product" ? (
            <ProductTile product={card.product} priority={i < ABOVE_FOLD} />
          ) : (
            <CampaignTile banner={card.banner} priority={i < ABOVE_FOLD} />
          )}
        </li>
      ))}
    </ul>
  );
}
