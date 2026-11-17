import { ROUTES, buildMetadata, jsonld, normalizePhone, whatsappUrl } from "@namilux/core";
import type { Metadata } from "next";
import { BrandChapter } from "@/components/home/BrandChapter";
import { BrandMarquee } from "@/components/home/BrandMarquee";
import { CollectionsGrid } from "@/components/home/CollectionsGrid";
import { Hero } from "@/components/home/Hero";
import { JournalTeasers } from "@/components/home/JournalTeasers";
import { ReadyRail } from "@/components/home/ReadyRail";
import { SaleGrid } from "@/components/home/SaleGrid";
import { ServiceStrip } from "@/components/home/ServiceStrip";
import { StoreChapter } from "@/components/home/StoreChapter";
import { Button } from "@/components/ui/Button";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadHome } from "@/server/loaders/home";
import { loadNav } from "@/server/loaders/nav";
import { loadLegacyHead, loadSettings } from "@/server/loaders/settings";
import { env } from "@/env";

const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadSettings();
  const seo = settings["seo.defaults"];
  // DECISION: the head comes from `seo_snapshots` via `loadLegacyHead("/")`, so the legacy title
  // «قیمت و خرید آنلاین لوازم خانگی دایسون dyson و اسمگ smeg✅» and its description ship byte for
  // byte. The seed had nowhere else to put the ten static-route heads - see the WHAT
  // in core/seo/legacy-head.ts - and the site name is the fallback when the baseline has no row,
  // so a database without the snapshot still renders a true head instead of an invented one.
  const legacy = await loadLegacyHead("/");
  const meta = buildMetadata(
    {
      path: "/",
      title: legacy?.title ?? seo.siteName,
      description: legacy?.description ?? null,
      robots: legacy?.robots ?? "index, follow",
      ogType: "website",
      ogImage: null,
      origin: env.SITE_ORIGIN,
      siteName: seo.siteName,
      titleTemplate: seo.titleTemplate,
    },
    { defaultOgKey: seo.defaultOgKey, mediaUrl },
  );
  return {
    title: meta.title,
    description: meta.description,
    alternates: meta.alternates,
    robots: meta.robots,
    openGraph: meta.openGraph,
  };
}

export default async function HomePage() {
  // Both loaders carry their own `"use cache"` + tags (home, content, catalog, settings), so the
  // page composes cached data without a second cache boundary of its own.
  const [home, settings, nav] = await Promise.all([loadHome(), loadSettings(), loadNav()]);
  const seo = settings["seo.defaults"];

  const graph = jsonld.graph([
    // Organization + WebSite are emitted once by the root layout; the homepage adds its own WebPage
    // node, which references them by @id.
    jsonld.webPage({ path: "/", title: seo.siteName }, {
      origin: env.SITE_ORIGIN,
      siteName: seo.siteName,
      store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
      mediaUrl,
    }),
  ]);

  // §9.1 module 4 and 6 are the same component over the two brand chapters getHomeData assembles.
  const [firstChapter, ...restChapters] = home.chapters;

  // The concierge promise is a WhatsApp conversation; an unset or malformed number must
  // not throw inside a render path, so it is normalized here and the strip states the promise as
  // plain text when there is no number.
  const whatsapp = normalizePhone(home.store.whatsapp);

  return (
    <>
      <JsonLd data={graph} />
      {/* 1 hero (frame) → 2 service strip (bg-soft) → 3 ready rail (bg) → 4 chapter (frame) →
          5 collections (bg-soft) → 6 chapter (frame) → 7 sale (bg) → 8 journal (bg-soft) →
          9 store (frame): the §9.1 rhythm is carried by the modules themselves, in this order.
          The promo bar belongs to (site)/layout.tsx - the page must not render a second one. */}
      {home.hero === null ? (
        // EDGE CASE: no live `home_hero` banner - `Hero` renders nothing and, as its header says,
        // the page owns the static fallback. Without it the homepage would ship with no <h1> at
        // all, and rules above fixes exactly one. Copy from fa.ts, ground from the
        // frame tokens: the same vitrine chapter, minus the photograph nobody uploaded yet.
        <section className="frame chapter">
          <div className="wrap grid gap-4">
            <h1 className="d-hero text-frame-ink">{t("home.hero.title")}</h1>
            <p className="t-lead max-w-[46ch] text-frame-ink-2">{t("home.hero.lead")}</p>
            <div>
              <Button variant="primary" size="lg" href={ROUTES.shop}>
                {t("home.hero.cta")}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Hero banner={home.hero} />
      )}
      <BrandMarquee brands={nav.brands} />
      <CollectionsGrid collections={home.collections} />
      <ServiceStrip whatsappHref={whatsapp === null ? "" : whatsappUrl(whatsapp)} />
      <ReadyRail items={home.readyRail} />
      {firstChapter === undefined ? null : <BrandChapter chapter={firstChapter} />}
      <SaleGrid items={home.saleGrid} />
      {restChapters.map((chapter) => (
        <BrandChapter key={chapter.brand.slug} chapter={chapter} />
      ))}
      <JournalTeasers posts={home.journal} />
      <StoreChapter store={home.store} />
    </>
  );
}
