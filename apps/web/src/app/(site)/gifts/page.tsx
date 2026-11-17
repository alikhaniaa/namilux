import {
  ROUTES,
  buildMetadata,
  isIndexablePlpState,
  jsonld,
  parsePlpState,
  plpMeta,
  productUrl,
  recordNotFound,
  titleFor,
} from "@namilux/core";
import type { PlpState, ProductScope } from "@namilux/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlpFallback } from "@/components/plp/PlpFallback";
import { PlpPage } from "@/components/plp/PlpPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadPlp } from "@/server/loaders/catalog";
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

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const SCOPE: ProductScope = { kind: "gifts" };
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
  // The scope term is "EXISTS collection_products JOIN collections kind='gift' status='active'"
  // (catalog/list.ts), so an empty UNFILTERED listing is exactly "no gift collection is active".
  const [settings, scopeListing] = await Promise.all([loadSettings(), loadPlp({ scope: SCOPE })]);
  if (scopeListing.total === 0) return { title: "" };

  const state = stateOf(await searchParams);
  const seo = settings["seo.defaults"];
  const meta = buildMetadata(
    plpMeta(
      {
        path: ROUTES.gifts,
        title: titleFor({ seoTitle: null, name: t("nav.gifts") }, seo.titleTemplate),
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

export default async function GiftsPage({ searchParams }: Props) {
  // DECISION: "404 while no gift collection is active" is read off the UNFILTERED scope, not off the
  // rendered listing - a price band that matches nothing owes the reader an EmptyState, not a 404.
  // Reading it from the listing rather than from `listCollections` keeps the page to the one query
  // it already makes (the unfiltered call is the same "use cache" entry <PlpPage> uses on a bare
  // `/gifts/`) and needs no second, uncached round trip. An active gift collection with no products
  // 404s as well: an empty gift page is the same dead end as a missing one.
  const [settings, scopeListing] = await Promise.all([loadSettings(), loadPlp({ scope: SCOPE })]);
  if (scopeListing.total === 0) {
    const referrer = (await headers()).get("referer") ?? undefined;
    // Fire-and-forget: the 404 monitor must never delay or fail the 404 itself.
    // The miss is recorded with a timestamp (Date.now()) - request time by definition; `connection()`
    // tells the prerenderer so (Next: blocking-prerender-current-time).
    await connection();
    void recordNotFound(db, ROUTES.gifts, referrer).catch(() => undefined);
    notFound();
  }

  const state = stateOf(await searchParams);
  const seo = settings["seo.defaults"];
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seo.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  // The ItemList is published for the first page of the unfiltered listing only - 
  // which is precisely the listing already loaded above.
  const listed =
    isIndexablePlpState(state) && (state.page ?? 1) === 1
      ? scopeListing.items.map((p) => ({ url: `${env.SITE_ORIGIN}${productUrl(p.slug)}`, name: p.displayName }))
      : [];

  const graph = jsonld.graph([
    jsonld.collection({ path: ROUTES.gifts, name: t("nav.gifts") }, listed, ctx),
    // the spec: BreadcrumbList on every page; the CollectionPage node references it by @id.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: ROUTES.home },
        { name: t("nav.shop"), href: ROUTES.shop },
        { name: t("nav.gifts"), href: ROUTES.gifts },
      ],
      ROUTES.gifts,
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
        <PlpPage scope={SCOPE} state={state} basePath={ROUTES.gifts} title={t("nav.gifts")} />
      </Suspense>
    </>
  );
}
