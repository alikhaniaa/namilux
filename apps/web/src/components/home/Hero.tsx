import { ROUTES } from "@namilux/core/client";
import type { Banner } from "@namilux/core/client";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";

export function Hero({ banner }: { banner: Banner | null }): React.ReactNode {
  // EDGE CASE: no live home_hero banner (getHomeData → hero null) - render nothing rather than an
  // empty graphite band; the page owns the static fallback.
  if (banner === null) return null;

  // rules (content/banners.ts): theme "dark" forces the graphite treatment and its media; "light"
  // and "auto" use the light photograph.
  // DECISION: the visitor's colour scheme does NOT pick the media. The hero is the LCP image
  // and the html.dark flip is a class, not a media query - resolving it on the client
  // would swap the largest image after hydration. The hero sits on the frame, which is the same
  // colour in both themes (§4), so one photograph is correct in both.
  const media = banner.theme === "dark" ? (banner.mediaDark ?? banner.mediaLight) : banner.mediaLight;
  const title = banner.title.trim() === "" ? t("home.hero.title") : banner.title;
  const ctaHref = banner.ctaHref ?? ROUTES.shop;
  const ctaLabel = banner.ctaLabel ?? t("home.hero.cta");

  return (
    <section className="frame hero-under-header relative isolate overflow-hidden">
      <div className="showcase-hero">
        {media === null ? null : (
          <Img
            image={media}
            slot="hero"
            // Decorative: the <h1> below carries the meaning.
            alt=""
            priority
            className="hero__reveal absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="showcase-hero__scrim" aria-hidden="true" />

        <div className="wrap showcase-hero__copy hero-kinetic">
          {/* DECISION: no kicker sentence - the Latin brand line is the kicker (the spec forbids
              inventing Persian copy in components). Each block rises out of its own mask. */}
          <p className="label hero-mask">
            <span style={{ "--d": "80ms" } as React.CSSProperties}>NAMILUX · SELECTED LIVING</span>
          </p>
          <h1 className="d-hero hero-mask text-frame-ink">
            <span style={{ "--d": "200ms" } as React.CSSProperties}>{title}</span>
          </h1>
          {banner.subtitle === null ? null : (
            <p className="t-lead hero-mask max-w-[46ch] text-frame-ink-2">
              <span style={{ "--d": "360ms" } as React.CSSProperties}>{banner.subtitle}</span>
            </p>
          )}
          {/* On .frame the primary button fills with --frame-ink: white on the photograph, and the
              accent is not spent here (§4). The quiet link drops to the collections module. */}
          <div className="hero-mask showcase-hero__links">
            <span style={{ "--d": "480ms" } as React.CSSProperties}>
              <Button variant="primary" size="lg" href={ctaHref} arrow>
                {ctaLabel}
              </Button>
              <Link href="#collections" className="link-under t-sm text-frame-ink">
                {t("nav.collections")}
              </Link>
            </span>
          </div>
        </div>
        <span className="hero-cue" aria-hidden="true" />
      </div>
    </section>
  );
}
