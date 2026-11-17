import {
  ROUTES,
  buildMetadata,
  collectionUrl,
  isIndexablePlpState,
  jsonld,
  parsePlpState,
  plpMeta,
  productUrl,
  recordNotFound,
} from "@namilux/core";
import type { CollectionView, PlpState, ProductScope } from "@namilux/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlpFallback } from "@/components/plp/PlpFallback";
import { PlpPage } from "@/components/plp/PlpPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadCollection, loadPlp } from "@/server/loaders/catalog";
import { collectionParams } from "@/server/static-params";
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
  return collectionParams();
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

/**
 * catalog/collections.ts keeps `live` out of `CollectionView` on purpose ("the page re-derives
 * `live` from `status` + `startsAt`/`endsAt`, which the view does carry"). Half-open window
 * [startsAt, endsAt), nulls open - the same predicate `isLiveWindow` applies server-side.
 */
function isLiveNow(c: CollectionView, at: Date): boolean {
  if (c.status !== "active") return false;
  const now = at.getTime();
  if (c.startsAt !== null && Date.parse(c.startsAt) > now) return false;
  if (c.endsAt !== null && Date.parse(c.endsAt) <= now) return false;
  return true;
}

/**
 * DECISION: two DONE headers disagree about a collection outside its window. This file says
 * "seasonal collections outside their window → 404 (never 410)"; catalog/collections.ts says the
 * router renders an ended state with `robots` noindex so campaign links never die. Both are
 * honoured by reading this module literally - only `kind: "season"` 404s; a campaign/gift/group
 * that has ended is still served, noindex, with its rails. A season is a window by definition and
 * has nothing to say once it closes; a campaign link in an SMS still has to land somewhere.
 */
const gone = (c: CollectionView, live: boolean): boolean => !live && c.kind === "season";

/**
 * 4 Sep 2026: only a season is ever "gone", and only the clock can say so. Evergreen collections are
 * judged from the cached view with no clock at all, so their pages prerender and are saved per path
 * (see generateStaticParams); a season asks for request time first (`connection()`), which keeps it
 * exact to the minute and out of the static set. `new Date()` before `connection()` is a prerender error.
 */
async function seasonGone(c: CollectionView): Promise<boolean> {
  if (c.kind !== "season") return false;
  await connection();
  return gone(c, isLiveNow(c, new Date()));
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const collection = await loadCollection((await params).slug);
  if (collection === null || (await seasonGone(collection))) return { title: "" };

  const state = stateOf(await searchParams);
  const seo = (await loadSettings())["seo.defaults"];
  const meta = buildMetadata(
    plpMeta(
      {
        path: collection.seo.canonical,
        title: collection.seo.title,
        description: collection.seo.description,
        // Verbatim: collections.ts already carries the not-live signal in `seo.robots`.
        robots: collection.seo.robots,
        ogType: "website",
        ogImage: collection.seo.ogImage,
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

export default async function CollectionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const collection = await loadCollection(slug);

  // A draft or archived collection never had a page; a season outside its window no longer has one.
  // 404, never 410 - the slug may be reused by next year's season.
  if (collection === null || (await seasonGone(collection))) {
    // Build-time prerender of a gone slug / the empty-table placeholder: plain 404, no request-time APIs.
    if (process.env.NEXT_PHASE === "phase-production-build") notFound();
    const referrer = (await headers()).get("referer") ?? undefined;
    // Fire-and-forget: the 404 monitor must never delay or fail the 404 itself.
    // The miss is recorded with a timestamp (Date.now()) - request time by definition; `connection()`
    // tells the prerenderer so (Next: blocking-prerender-current-time).
    await connection();
    void recordNotFound(db, `/collection/${slug}/`, referrer).catch(() => undefined);
    notFound();
  }

  const state = stateOf(await searchParams);
  const scope: ProductScope = { kind: "collection", id: collection.id };
  const basePath = collectionUrl(collection.slug);
  // DECISION: the structured data reads the listing through the SAME call <PlpPage> makes
  // (`loadPlp({ scope, ...state })`, one "use cache" entry) rather than through `loadPlpFor`, whose
  // `{ ...normalized, scope }` argument shape would key a second entry and cost the page a second
  // listProducts query. `parsePlpState` has already normalised the state.
  const [settings, listing] = await Promise.all([loadSettings(), loadPlp({ scope, ...state })]);
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
    jsonld.collection({ path: collection.seo.canonical, name: collection.name }, listed, ctx),
    // the spec: BreadcrumbList on every page; the CollectionPage node references it by @id.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: ROUTES.home },
        { name: t("nav.shop"), href: ROUTES.shop },
        { name: collection.name, href: basePath },
      ],
      collection.seo.canonical,
      ctx,
    ),
  ]);

  const chips = collection.children.map((child) => ({
    href: collectionUrl(child.slug),
    label: child.name,
    count: child.count,
  }));

  // DECISION: coverDark is a fallback, not a theme switch - the same reading CollectionsGrid took.
  // One cover is correct in both themes and the page stays a single cacheable payload.
  const cover = collection.cover ?? collection.coverDark;

  return (
    <>
      <JsonLd data={graph} />
      {/* UI v4.2: the cover is the hero visual beside the name (PlpHero); the children are its pills. */}
      <Suspense fallback={<PlpFallback />}>
        <PlpPage
          scope={scope}
          state={state}
          basePath={basePath}
          title={collection.name}
          descriptionHtml={collection.descriptionHtml}
          hero={{ eyebrow: t("plp.facet.collection"), image: cover, imageAlt: collection.name }}
          {...(chips.length === 0 ? {} : { chips })}
          crumbs={[
            { name: t("tab.home"), href: "/" },
            { name: t("nav.shop"), href: ROUTES.shop },
            { name: collection.name, href: collectionUrl(collection.slug) },
          ]}
        />
      </Suspense>
    </>
  );
}
