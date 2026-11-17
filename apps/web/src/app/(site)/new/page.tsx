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

// BLOCKED (reported, not fixed here): every listProducts/computeFacets call with this scope
// throws inside packages/core/src/catalog/products.repo.ts - `scopeWhereSql` case "new" binds a JS
// `Date` as the `published_at >=` parameter and the postgres.js driver cannot serialize it. The
// route below is complete and starts serving the moment that parameter becomes an ISO string.
const SCOPE: ProductScope = { kind: "new" };
const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

/** The thin-page guard of the header: below this many arrivals the page is not worth indexing. */
const MIN_INDEXABLE_ITEMS = 8;

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
 * Newest first is what this scope means.
 * DECISION: the default is applied to the LISTING state only, never to the metadata state - a sort
 * the page chose for itself is not a filter the reader picked, and the spec makes only the latter
 * `noindex`. `/new/` therefore keeps a self-canonical.
 */
const listStateOf = (state: PlpState): PlpState => ({ ...state, sort: state.sort ?? "newest" });

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const state = stateOf(await searchParams);
  const [settings, listing] = await Promise.all([
    loadSettings(),
    loadPlp({ scope: SCOPE, ...listStateOf(state) }),
  ]);
  const seo = settings["seo.defaults"];
  const meta = buildMetadata(
    plpMeta(
      {
        path: ROUTES.new,
        title: titleFor({ seoTitle: null, name: t("nav.new") }, seo.titleTemplate),
        description: null,
        // Thin-page guard: a shop week with three arrivals must not publish a three-tile listing to
        // the index. `follow` keeps the products themselves discoverable through it.
        robots: listing.total >= MIN_INDEXABLE_ITEMS ? "index, follow" : "noindex, follow",
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

export default async function NewPage({ searchParams }: Props) {
  const state = stateOf(await searchParams);
  const listState = listStateOf(state);
  // DECISION: the structured data reads the listing through the SAME call <PlpPage> makes
  // (`loadPlp({ scope, ...state })`, one "use cache" entry) rather than through `loadPlpFor`, whose
  // `{ ...normalized, scope }` argument shape would key a second entry and cost the page a second
  // listProducts query. `parsePlpState` has already normalised the state.
  const [settings, listing] = await Promise.all([loadSettings(), loadPlp({ scope: SCOPE, ...listState })]);
  const seo = settings["seo.defaults"];
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seo.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  // The ItemList is published for the first page of the unfiltered listing only.
  const listed =
    isIndexablePlpState(state) && (state.page ?? 1) === 1
      ? listing.items.map((p) => ({ url: `${env.SITE_ORIGIN}${productUrl(p.slug)}`, name: p.displayName }))
      : [];

  const graph = jsonld.graph([
    jsonld.collection({ path: ROUTES.new, name: t("nav.new") }, listed, ctx),
    // the spec: BreadcrumbList on every page; the CollectionPage node references it by @id.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: ROUTES.home },
        { name: t("nav.shop"), href: ROUTES.shop },
        { name: t("nav.new"), href: ROUTES.new },
      ],
      ROUTES.new,
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
        <PlpPage scope={SCOPE} state={listState} basePath={ROUTES.new} title={t("nav.new")} />
      </Suspense>
    </>
  );
}
