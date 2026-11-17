import type { Crumb, ImageRef } from "@namilux/core/client";
import { CollectionChips } from "./CollectionChips";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

export type PlpHeroLink = { href: string; label: string; count: number; current?: boolean };

export function PlpHero({
  title,
  total,
  ready,
  crumbs,
  kicker,
  eyebrow,
  claim,
  image,
  imageAlt,
  links,
  linksLabel,
}: {
  title: string;
  total: number;
  ready?: number;
  crumbs?: Crumb[];
  /** Latin, set in the serif - the brand mark. */
  kicker?: string;
  /** Persian eyebrow when there is no Latin mark («دسته‌بندی», «مجموعه» …). */
  eyebrow?: string;
  claim?: string | null;
  image?: ImageRef | null;
  imageAlt?: string;
  links?: PlpHeroLink[];
  linksLabel?: string;
}): React.ReactNode {
  const hasImage = image !== undefined && image !== null;
  const hasLinks = links !== undefined && links.length > 0;

  return (
    <section className="plp-hero" data-reveal>
      <div className={`wrap plp-hero__grid${hasImage ? "" : " plp-hero__grid--solo"}`}>
        <div className="plp-hero__copy plp-head">
          {crumbs === undefined || crumbs.length === 0 ? null : <Breadcrumb crumbs={crumbs} />}
          {kicker !== undefined && kicker.trim() !== "" ? (
            <p className="label">{kicker}</p>
          ) : eyebrow === undefined ? null : (
            <p className="eyebrow">{eyebrow}</p>
          )}
          <h1>{title}</h1>
          {claim === undefined || claim === null || claim.trim() === "" ? null : <p className="plp-hero__claim">{claim}</p>}
          <p className="plp-hero__meta">
            <span>{t("plp.count", { n: total })}</span>
            {ready === undefined || ready === 0 ? null : <span className="dot">{t("plp.countReady", { n: ready })}</span>}
          </p>
          {hasLinks ? (
            <div className="plp-hero__links">
              {linksLabel === undefined ? null : <p className="plp-hero__links-label">{linksLabel}</p>}
              <CollectionChips chips={links} />
            </div>
          ) : null}
        </div>
        {hasImage ? (
          <div className="plp-hero__visual" data-reveal="photo">
            <div className="plate plate--wide editorial-cover">
              <Img image={image} slot="band" alt={imageAlt ?? ""} sizes="(min-width:1024px) 45vw, 100vw" />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
