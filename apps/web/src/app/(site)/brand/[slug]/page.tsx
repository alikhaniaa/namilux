import {
  ROUTES,
  absUrl,
  brandUrl,
  buildMetadata,
  isIndexablePlpState,
  jsonld,
  parsePlpState,
  plpMeta,
  productUrl,
  recordNotFound,
  resolveRedirect,
} from "@namilux/core";
import type { BrandView, PlpState, ProductScope } from "@namilux/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlpFallback } from "@/components/plp/PlpFallback";
import { PlpPage } from "@/components/plp/PlpPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadBrand, loadPlp } from "@/server/loaders/catalog";
import { brandParams } from "@/server/static-params";
import { loadBanners } from "@/server/loaders/content";
import { loadSettings } from "@/server/loaders/settings";
import { db } from "@/lib/db";
import { env } from "@/env";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

/** Same DECISION as product/[slug]/page.tsx (4 Sep 2026): prerendered at build, runtime paths saved to disk. */
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return brandParams();
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

/** v2 §11.1 - below this share of buyable stock the listing opens on the in-stock chip. */
const READY_CHIP_THRESHOLD = 0.2;

/** Next hands `searchParams` as a plain object; `parsePlpState` is defined over URLSearchParams. */
function stateOf(sp: Record<string, string | string[] | undefined>): PlpState {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const one of value) params.append(key, one);
  }
  return parsePlpState(params);
}

/**
 * v2 §11.1: a brand whose shelf is mostly unpriced opens on the availability chip, so the first
 * screen is something the reader can actually buy.
 * DECISION: the default is applied to the LISTING state only, never to the metadata state - the
 * brand URL stays indexable with a self-canonical, because the spec makes only a filter the
 * reader CHOSE noindex. It is skipped when the reader already expressed an availability, and when
 * nothing is buyable at all (that brand gets the coming-soon band instead of an empty grid).
 */
function listStateOf(state: PlpState, brand: BrandView): PlpState {
  if (state.avail !== undefined || brand.buyableCount === 0) return state;
  if (brand.buyableCount >= brand.productCount * READY_CHIP_THRESHOLD) return state;
  return { ...state, avail: ["in"] };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const brand = await loadBrand((await params).slug);
  if (brand === null) return { title: "" };

  const state = stateOf(await searchParams);
  const seo = (await loadSettings())["seo.defaults"];
  // Verbatim for the 7 legacy brands (including the 5 whose pages used to 404); catalog/brands.ts
  // already falls back to the site title template for a new brand, which is what titleFor does.
  const meta = buildMetadata(
    plpMeta(
      {
        path: brand.seo.canonical,
        title: brand.seo.title,
        description: brand.seo.description,
        robots: brand.seo.robots,
        ogType: "website",
        ogImage: brand.seo.ogImage,
        origin: env.SITE_ORIGIN,
        siteName: seo.siteName,
        titleTemplate: seo.titleTemplate,
      },
      state,
    ),
    { defaultOgKey: seo.defaultOgKey, mediaUrl },
  );
  return {
    title: meta.title,
    ...(meta.description === undefined ? {} : { description: meta.description }),
    alternates: meta.alternates,
    robots: meta.robots,
    openGraph: meta.openGraph,
  };
}

export default async function BrandPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const brand = await loadBrand(slug);

  if (brand === null) {
    // An inactive brand is not served: archive.ts wrote `/brand/<slug>/` → `/shop/` when it was
    // deactivated, so the redirect table answers before the 404 does.
    const asked = `/brand/${slug}/`;
    // A miss is request time by definition (it is recorded with a timestamp and the driver draws
    // ids); `connection()` tells the prerenderer before the first uncached query (Next: blocking-prerender-*).
    // Build-time prerender of a gone slug / the empty-table placeholder: plain 404, no request-time APIs.
    if (process.env.NEXT_PHASE === "phase-production-build") notFound();
    await connection();
    const hit = await resolveRedirect(db, asked);
    if (hit !== null && hit.code === 301) permanentRedirect(hit.to);
    const referrer = (await headers()).get("referer") ?? undefined;
    // Fire-and-forget: the 404 monitor must never delay or fail the 404 itself.
    void recordNotFound(db, asked, referrer).catch(() => undefined);
    notFound();
  }

  const state = stateOf(await searchParams);
  const scope: ProductScope = { kind: "brand", id: brand.id };
  const basePath = brandUrl(brand.slug);
  const listState = listStateOf(state, brand);
  // DECISION: the structured data reads the listing through the SAME call <PlpPage> makes
  // (`loadPlp({ scope, ...state })`, one "use cache" entry) rather than through `loadPlpFor`, whose
  // `{ ...normalized, scope }` argument shape would key a second entry and cost the page a second
  // listProducts query. `parsePlpState` has already normalised the state.
  const [settings, listing, bands] = await Promise.all([loadSettings(), loadPlp({ scope, ...listState }), loadBanners("home_band")]);
  const seoDefaults = settings["seo.defaults"];
  // UI v4.2: the brand chapter photograph (the home_band banner targeted at it) is the hero visual;
  // a brand without one gets the serif ghost of its mark instead - never an empty plate.
  const band = bands.find((b) => b.targeting?.brandSlug === brand.slug) ?? null;
  const heroImage = band === null ? null : (band.mediaLight ?? band.mediaDark);
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seoDefaults.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  // The ItemList is published for the first page of the unfiltered listing only.
  const listed =
    isIndexablePlpState(state) && (state.page ?? 1) === 1
      ? listing.items.map((p) => ({ url: `${env.SITE_ORIGIN}${productUrl(p.slug)}`, name: p.displayName }))
      : [];

  const pageUrl = absUrl(env.SITE_ORIGIN, brand.seo.canonical);
  // DECISION: the Brand node is written here because the jsonld contract of @namilux/core
  // has no `brand()` builder - orgSite, breadcrumb, webPage, product, collection, post and faq only.
  // packages/core/src/seo/jsonld.ts is the right home for one; reported instead of created.
  const brandNode = {
    "@type": "Brand",
    "@id": `${pageUrl}#brand`,
    name: brand.nameFa,
    ...(brand.nameEn === "" ? {} : { alternateName: brand.nameEn }),
    url: pageUrl,
    ...(brand.logo === null ? {} : { logo: mediaUrl(brand.logo.key) }),
  };

  const graph = jsonld.graph([
    jsonld.collection({ path: brand.seo.canonical, name: brand.nameFa }, listed, ctx),
    brandNode,
    // brands.ts rules: home, shop, brand - there is no brand index page to sit between them.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: ROUTES.home },
        { name: t("nav.shop"), href: ROUTES.shop },
        { name: brand.nameFa, href: basePath },
      ],
      brand.seo.canonical,
      ctx,
    ),
  ]);

  return (
    <>
      <JsonLd data={graph} />
      {/* UI v4.2: the Latin mark, the claim and the chapter photograph live in the listing hero now
          (one <h1>, the spec); the legacy story is the editorial block under the grid. */}
      <Suspense fallback={<PlpFallback />}>
        <PlpPage
          scope={scope}
          state={listState}
          basePath={basePath}
          title={brand.nameFa}
          descriptionHtml={brand.storyHtml}
          hero={{ kicker: brand.nameEn, claim: brand.claim, image: heroImage, imageAlt: brand.nameFa }}
          crumbs={[
            { name: t("tab.home"), href: ROUTES.home },
            { name: t("nav.shop"), href: ROUTES.shop },
            { name: brand.nameFa, href: basePath },
          ]}
          {...(brand.buyableCount === 0 ? { comingSoon: { brand: brand.nameFa } } : {})}
        />
      </Suspense>
    </>
  );
}
