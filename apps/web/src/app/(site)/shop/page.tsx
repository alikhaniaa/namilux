import {
  ROUTES,
  buildMetadata,
  isIndexablePlpState,
  jsonld,
  parsePlpState,
  plpMeta,
  productUrl,
  titleFor,
} from "@namilux/core";
import type { PlpState, ProductScope } from "@namilux/core";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlpFallback } from "@/components/plp/PlpFallback";
import { PlpPage } from "@/components/plp/PlpPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadPlp } from "@/server/loaders/catalog";
import { loadNav } from "@/server/loaders/nav";
import { loadSettings } from "@/server/loaders/settings";
import { env } from "@/env";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SCOPE: ProductScope = { kind: "all" };
const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

/** Next hands `searchParams` as a plain object; `parsePlpState` is defined over URLSearchParams. */
function stateOf(sp: Record<string, string | string[] | undefined>): PlpState {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const one of value) params.append(key, one);
  }
  return parsePlpState(params);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const state = stateOf(await searchParams);
  const seo = (await loadSettings())["seo.defaults"];
  // DECISION: the legacy `<title>` of /shop/ is «فروشگاه - نامی لوکس», which is exactly
  // titleTemplate applied to «فروشگاه» - so parity comes out of the settings template instead of a
  // Persian literal here. The legacy meta description («محصولات Archive …») is a
  // WooCommerce scrape string with no seeded source, and a missing description stays missing
  //.
  const meta = buildMetadata(
    plpMeta(
      {
        path: ROUTES.shop,
        title: titleFor({ seoTitle: null, name: t("nav.shop") }, seo.titleTemplate),
        description: null,
        robots: "index, follow",
        ogType: "website",
        ogImage: null,
        origin: env.SITE_ORIGIN,
        siteName: seo.siteName,
        titleTemplate: seo.titleTemplate,
      },
      state,
    ),
    { defaultOgKey: seo.defaultOgKey, mediaUrl },
  );
  return { title: meta.title, alternates: meta.alternates, robots: meta.robots, openGraph: meta.openGraph };
}

export default async function ShopPage({ searchParams }: Props) {
  const state = stateOf(await searchParams);
  // DECISION: the JSON-LD reads the listing through the SAME call <PlpPage> makes
  // (`loadPlp({ scope, ...state })`, one "use cache" entry), rather than through `loadPlpFor`,
  // whose `{ ...normalized, scope }` argument shape would key a second entry and cost the page a
  // second listProducts query. `parsePlpState` has already normalised the state.
  const [settings, listing, nav] = await Promise.all([loadSettings(), loadPlp({ scope: SCOPE, ...state }), loadNav()]);
  const seo = settings["seo.defaults"];
  // UI v4.2: the whole shop opens on its collection groups as pills - the same directory the mega
  // panel shows, each a real URL.
  const quickLinks = nav.collections.map((c) => ({ href: c.href, label: c.name, count: c.count }));
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seo.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  // contract: the ItemList is published for the first page of the unfiltered listing only - a
  // filtered view is `noindex, follow` and must not offer a second, narrower item list for the
  // same canonical.
  const listed =
    isIndexablePlpState(state) && (state.page ?? 1) === 1
      ? listing.items.map((p) => ({ url: `${env.SITE_ORIGIN}${productUrl(p.slug)}`, name: p.displayName }))
      : [];

  const graph = jsonld.graph([
    jsonld.collection({ path: ROUTES.shop, name: t("nav.shop") }, listed, ctx),
    // the spec: BreadcrumbList on every page - it is also what the legacy head published here,
    // and the CollectionPage node references `#breadcrumb` by id.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: ROUTES.home },
        { name: t("nav.shop"), href: ROUTES.shop },
      ],
      ROUTES.shop,
      ctx,
    ),
  ]);

  return (
    <>
      <JsonLd data={graph} />
      {/* PlpPage's toolbar reads useSearchParams, so with cacheComponents it needs a boundary of its
          own. DECISION: the fallback is null - PlpPage owns the whole visible body of this route
          (its own header included), so there is nothing above it that could shift. */}
      <Suspense fallback={<PlpFallback />}>
        <PlpPage scope={SCOPE} state={state} basePath={ROUTES.shop} title={t("nav.shop")} hero={{ eyebrow: t("nav.all") }} quickLinks={quickLinks} />
      </Suspense>
    </>
  );
}
