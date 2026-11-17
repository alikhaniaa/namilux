import type { ImageRef } from "@namilux/core/client";
import Link from "next/link";
import { Img } from "@/components/ui/Img";

type StripBrand = { slug: string; name: string; nameEn: string; href: string; image: ImageRef | null };

/**
 * The houses the shop carries, as their own marks on a stone plate under the hero: a slow drift,
 * paused under the pointer, every mark a link to the brand's listing. A brand without a logo file
 * falls back to its Latin name in the serif.
 *
 * The loop is seamless because the track holds two identical groups of fixed-width items and the
 * animation moves it by exactly one group (50 %); the strip is laid out LTR so the track starts at
 * the left edge and never drifts out of view on the RTL page. The second group is hidden from
 * assistive technology and the tab order.
 */
export function BrandMarquee({ brands }: { brands: StripBrand[] }): React.ReactNode {
  const seen = new Set<string>();
  const unique = brands.filter((b) => {
    if (seen.has(b.slug)) return false;
    seen.add(b.slug);
    return true;
  });
  if (unique.length < 3) return null;

  const group = (copy: 0 | 1): React.ReactNode => (
    <div className="logo-strip__group" aria-hidden={copy === 1 ? "true" : undefined}>
      {unique.map((b) => (
        <Link key={b.slug} href={b.href} className="logo-strip__item" title={b.name} tabIndex={copy === 1 ? -1 : undefined}>
          {b.image === null ? (
            <span className="logo-strip__name">{b.nameEn}</span>
          ) : (
            <Img image={b.image} slot="thumb" alt={copy === 0 ? b.name : ""} />
          )}
        </Link>
      ))}
    </div>
  );

  return (
    <section className="logo-strip" style={{ "--n": unique.length } as React.CSSProperties}>
      <div className="logo-strip__track">
        {group(0)}
        {group(1)}
      </div>
    </section>
  );
}
