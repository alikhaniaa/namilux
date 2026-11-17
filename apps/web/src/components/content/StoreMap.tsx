import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

/**
 * The shop's location, as a real map.
 *
 * DECISION - why this is a self-hosted still and not an embed. The storefront's CSP is
 * `default-src 'self'` with `img-src 'self' data: blob:` plus the two trust-seal hosts, and
 * `frame-ancestors 'none'` (security/headers.ts). A Google or Neshan iframe, their tile servers
 * and a "static map" minted by either of them are all third-party loads, so every one of them is
 * blocked - and widening the policy for a location picture would be the worst trade on the page.
 *
 * So the map was rendered once, offline: fifteen OpenStreetMap tiles at zoom ۱۷ stitched with
 * sharp, the pin composited at the shop's own coordinate, WebP and PNG at 1200×600 and 600×300,
 * committed under `public/brand/`. It is a plain first-party `<img>` - no runtime tile fetch, no
 * script, no CSP entry. The previous version of this component drew a *schematic* of the streets
 * in inline SVG and captioned itself «طرح راهنما، نه نقشهٔ مقیاس‌دار»; the owner asked, fairly,
 * why a disclaimer about a drawing was on a production site. There is nothing to disclaim now.
 *
 * The path lives under `/brand/…` on purpose: the proxy's route oracle answers a real 404 for any
 * unknown top-level namespace (lib/route-status.ts), and `brand` is one of the segments it skips - 
 * a `/map/…` folder in `public/` would have 404ed on the box while serving fine in `next dev`.
 *
 * ATTRIBUTION is required by the ODbL and is deliberately page text, not pixels baked into the
 * image: it stays legible at any width and survives the picture being re-rendered.
 */

/** The versioned folder the stills live in; a new render gets a new date and a new URL. */
const MAP = "/brand/map-shush-20260908";

/** The right column of `.about-visit` at the widest layout, full width below the breakpoint. */
const SIZES = "(min-width: 1360px) 620px, (min-width: 768px) 46vw, 100vw";

export function StoreMap({ mapUrl }: { mapUrl: string }): React.ReactNode {
  const href = mapUrl.trim();

  const plate = (
    <picture>
      <source
        type="image/webp"
        srcSet={`${MAP}/shush-600.webp 600w, ${MAP}/shush-1200.webp 1200w`}
        sizes={SIZES}
      />
      <img
        src={`${MAP}/shush-600.png`}
        srcSet={`${MAP}/shush-600.png 600w, ${MAP}/shush-1200.png 1200w`}
        sizes={SIZES}
        width={1200}
        height={600}
        alt={t("page.about.map.alt")}
        loading="lazy"
        decoding="async"
        className="store-map__img"
      />
    </picture>
  );

  return (
    <figure className="store-map">
      {/* An external destination, so a bare <a> with rel="noopener": a Next <Link> carries neither
          target nor rel. An empty setting costs the link, never the picture. */}
      {href === "" ? (
        plate
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer" className="store-map__link">
          {plate}
          <span className="store-map__cta link-under">
            <Icon name="location" size={16} />
            {t("page.about.map.view")}
          </span>
        </a>
      )}
      <figcaption className="store-map__credit t-xs">
        {/* Latin inside an RTL paragraph: <bdi dir="ltr"> keeps the © in front of the words. */}
        <bdi dir="ltr">{t("page.about.map.credit")}</bdi>
      </figcaption>
    </figure>
  );
}
