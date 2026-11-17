import { brandUrl } from "@namilux/core/client";
import type { BrandChapter as BrandChapterData } from "@namilux/core/client";
import { Button } from "@/components/ui/Button";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

export function BrandChapter({ chapter }: { chapter: BrandChapterData }): React.ReactNode {
  const { brand, banner } = chapter;
  // rules (catalog/home.ts): a missing band banner is an allowed state - the chapter then renders
  // the brand's claim only, never an empty photo well.
  const media = banner === null ? null : (banner.theme === "dark" ? (banner.mediaDark ?? banner.mediaLight) : banner.mediaLight);
  // The band's own subtitle is campaign copy; the brand's claim is the durable line, so it wins.
  const claim = brand.claim ?? banner?.subtitle ?? null;

  return (
    // "frame chapter reveal": graphite ground, chapter spacing (96 / 160), scroll-driven fade-up.
    <section className={`frame showcase-chapter below-fold${media === null ? " showcase-chapter--text" : ""}`}>
      {/* UI v4: the Latin mark as a ghost in the serif italic behind the chapter. Decorative. */}
      <span className="showcase-chapter__ghost" aria-hidden="true" dir="ltr">
        {brand.nameEn}
      </span>
      <div className="wrap showcase-chapter__grid">
      {media === null ? null : (
        <div className="showcase-chapter__photo" data-reveal="photo">
          {/* §11: .band__img is the parallax recipe; it needs the clipped box around it. */}
          <Img image={media} slot="band" alt="" />
        </div>
      )}

      <div className="showcase-chapter__copy" data-reveal>
        {/* DECISION: the .label line is the brand's Latin name alone. §9.1 illustrates it as
            «SMEG · 1948», but no founding year exists in BrandView or in any settings key, and
            typing one would invent catalogue data. */}
        <p className="label text-frame-ink-2">{brand.nameEn}</p>
        <h2 className="d-1 text-frame-ink">{brand.nameFa}</h2>
        {claim === null ? null : <p className="t-lead max-w-[52ch] text-frame-ink-2">{claim}</p>}
        {/* DECISION: the CTA always goes to the brand page. A home_band banner may carry its own
            ctaHref, but §9.1 fixes this button to «دیدن مجموعه» - the brand's own listing - and a
            campaign link under a label that promises the collection would mislead. */}
        <div>
          <Button variant="primary" href={brandUrl(brand.slug)} arrow>
            {t("home.brand.cta")}
          </Button>
        </div>
      </div>
    </div></section>
  );
}
