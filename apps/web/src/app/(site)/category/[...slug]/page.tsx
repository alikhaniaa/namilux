import {
  buildMetadata,
  categoryUrl,
  decPath,
  isIndexablePlpState,
  jsonld,
  parsePlpState,
  plpMeta,
  productUrl,
  recordNotFound,
  resolveRedirect,
} from "@namilux/core";
import type { CategoryView, PlpState, ProductScope } from "@namilux/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlpFallback } from "@/components/plp/PlpFallback";
import { PlpPage } from "@/components/plp/PlpPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadCategory, loadPlp } from "@/server/loaders/catalog";
import { categoryParams } from "@/server/static-params";
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
export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  return categoryParams();
}

type Props = {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

/**
 * the spec: `/category/<path>/` is a MULTI-segment decoded Persian path. Next hands the segments
 * already decoded; `decPath` is applied anyway so a double-encoded request resolves to the same row
 * (it is a no-op on a segment that carries no percent-triplet), and empty segments are dropped so
 * "//" can never mint a path the DB does not have.
 */
function pathOf(slug: string[]): string {
  return slug
    .map((seg) => decPath(seg))
    .filter((seg) => seg !== "")
    .join("/");
}

function stateOf(sp: Record<string, string | string[] | undefined>): PlpState {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.append(key, value);
    else if (Array.isArray(value)) for (const one of value) params.append(key, one);
  }
  return parsePlpState(params);
}

const scopeOf = (category: CategoryView): ProductScope => ({ kind: "category", id: category.id });

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const path = pathOf((await params).slug);
  const category = path === "" ? null : await loadCategory(path);
  if (category === null) return { title: "" };

  const state = stateOf(await searchParams);
  const seo = (await loadSettings())["seo.defaults"];
  const meta = buildMetadata(
    plpMeta(
      {
        // The canonical is the DECODED site path; buildMetadata re-encodes it to the lowercase-hex,
        // trailing-slash form the 752-URL contract is written in (EDGE CASE above).
        path: category.seo.canonical,
        title: category.seo.title,
        description: category.seo.description,
        // Verbatim - the 15 legacy noindex categories stay noindex (parity, the spec).
        robots: category.seo.robots,
        ogType: "website",
        ogImage: category.seo.ogImage,
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

export default async function CategoryPage({ params, searchParams }: Props) {
  const path = pathOf((await params).slug);
  const category = path === "" ? null : await loadCategory(path);

  if (category === null) {
    // EDGE CASE: several legacy category URLs are live 301s («بلاگ» → /blog/, «محصولات-اسمگ» →
    // /brand/smeg/). The uncached redirect lookup runs only after the cached read missed.
    const asked = `/category/${path}/`;
    // A miss is request time by definition (it is recorded with a timestamp and the driver draws
    // ids); `connection()` tells the prerenderer before the first uncached query (Next: blocking-prerender-*).
    // Build-time prerender of a gone path / the empty-table placeholder: plain 404, no request-time APIs.
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
  const scope = scopeOf(category);
  const basePath = categoryUrl(category.path);
  // One cache entry for the page and for its structured data - the same call <PlpPage> makes.
  const [settings, listing] = await Promise.all([loadSettings(), loadPlp({ scope, ...state })]);
  const seo = settings["seo.defaults"];
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seo.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  // ItemList on the first page of the unfiltered listing only.
  const listed =
    isIndexablePlpState(state) && (state.page ?? 1) === 1
      ? listing.items.map((p) => ({ url: `${env.SITE_ORIGIN}${productUrl(p.slug)}`, name: p.displayName }))
      : [];

  const graph = jsonld.graph([
    jsonld.collection({ path: category.seo.canonical, name: category.name }, listed, ctx),
    // crumbs are [«خانه», «فروشگاه», …ancestors, self] and their hrefs are already encoded.
    jsonld.breadcrumb(category.crumbs, category.seo.canonical, ctx),
  ]);

  const chips = category.children.map((child) => ({
    href: categoryUrl(child.path),
    label: child.name,
    count: child.count,
  }));

  return (
    <>
      <JsonLd data={graph} />
      {/* PlpPage's toolbar reads useSearchParams; with cacheComponents it owns a boundary. The
          fallback is null: PlpPage renders this route's whole visible body, header included. */}
      <Suspense fallback={<PlpFallback />}>
        <PlpPage
          scope={scope}
          state={state}
          basePath={basePath}
          title={category.name}
          descriptionHtml={category.descriptionHtml}
          hero={{ eyebrow: t("product.category") }}
          {...(chips.length === 0 ? {} : { chips })}
          crumbs={category.crumbs}
        />
      </Suspense>
    </>
  );
}
