import { ROUTES, buildMetadata, decPath, jsonld, recordNotFound, resolveRedirect } from "@namilux/core";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { ArticleBody } from "@/components/journal/ArticleBody";
import { ArticleHeader } from "@/components/journal/ArticleHeader";
import { ArticleProducts } from "@/components/journal/ArticleProducts";
import { AboutPage } from "@/components/content/AboutPage";
import { PageBody } from "@/components/content/PageBody";
import { ReturnsPage } from "@/components/content/ReturnsPage";
import { StorePage } from "@/components/content/StorePage";
import { WarrantyPage } from "@/components/content/WarrantyPage";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadBrandMarks, loadProductCards } from "@/server/loaders/catalog";
import { loadRootSlug } from "@/server/loaders/content";
import { loadSettings } from "@/server/loaders/settings";
import { rootSlugParams } from "@/server/static-params";
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
  return rootSlugParams();
}

type Props = { params: Promise<{ slug: string }> };

const mediaUrl = (key: string): string => `${env.SITE_ORIGIN}/media/${key}`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const found = await loadRootSlug(decPath(slug));
  if (found === null) return { title: "" };

  const settings = await loadSettings();
  const seo = found.kind === "post" ? found.post.seo : found.page.seo;
  const meta = buildMetadata(
    {
      path: `/${decPath(slug)}/`,
      title: seo.title,
      description: seo.description,
      robots: seo.robots,
      ogType: found.kind === "post" ? "article" : "website",
      ogImage: seo.ogImage,
      origin: env.SITE_ORIGIN,
      siteName: settings["seo.defaults"].siteName,
      titleTemplate: settings["seo.defaults"].titleTemplate,
      ...(found.kind === "post" ? { publishedAt: found.post.publishedAt, modifiedAt: found.post.updatedAt } : {}),
    },
    { defaultOgKey: settings["seo.defaults"].defaultOgKey, mediaUrl },
  );
  return { title: meta.title, description: meta.description, alternates: meta.alternates, robots: meta.robots, openGraph: meta.openGraph };
}

export default async function RootSlugPage({ params }: Props) {
  const { slug } = await params;
  const decoded = decPath(slug);
  const path = `/${decoded}/`;
  const found = await loadRootSlug(decoded);

  if (found === null) {
    // Only now, after both cached reads missed, does the uncached redirect lookup run.
    // A miss is request time by definition (it is recorded with a timestamp and the driver draws
    // ids); `connection()` tells the prerenderer before the first uncached query (Next: blocking-prerender-*).
    // Build-time prerender of a gone slug / the empty-table placeholder: plain 404, no request-time APIs.
    if (process.env.NEXT_PHASE === "phase-production-build") notFound();
    await connection();
    const hit = await resolveRedirect(db, path);
    if (hit !== null && hit.code === 301) permanentRedirect(hit.to);
    const referrer = (await headers()).get("referer") ?? undefined;
    // Fire-and-forget: the 404 monitor must never delay or fail the 404 itself.
    void recordNotFound(db, path, referrer).catch(() => undefined);
    notFound();
  }

  const settings = await loadSettings();
  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: settings["seo.defaults"].siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl,
  };

  if (found.kind === "post") {
    const related = found.post.relatedProductIds.length > 0 ? await loadProductCards(found.post.relatedProductIds) : [];
    return (
      <>
        {/* the spec: BreadcrumbList on every page, and the legacy head of all 150 posts carried a
            WebPage node beside the BlogPosting. Both were missing - the parity crawl reported
            WebPage ×162 / BreadcrumbList ×159 absent from schema_types. */}
        <JsonLd
          data={jsonld.graph([
            jsonld.post(found.post, { path }, ctx),
            jsonld.webPage({ path, title: found.post.title }, ctx),
            jsonld.breadcrumb(
              [
                { name: t("tab.home"), href: ROUTES.home },
                { name: t("nav.journal"), href: ROUTES.blog },
                { name: found.post.title, href: path },
              ],
              path,
              ctx,
            ),
          ])}
        />
        <ArticleHeader post={found.post} />
        <ArticleBody html={found.post.bodyHtml} />
        <ArticleProducts items={related} />
      </>
    );
  }

  const page = found.page;

  // The About page is the one static page whose JSON-LD says more than "a page exists": it is the
  // page about the business, so it carries the shop's opening hours, telephone and map pin
  // (jsonld.localBusiness merges into the layout's Organization node by @id).
  const isAbout = page.template === "about";
  // The houses come from the catalogue, never from a list typed into this file - the shop went from
  // two brands to five and a hard-coded list would have gone on advertising two.
  const aboutBrands = isAbout ? await loadBrandMarks() : [];

  return (
    <>
      {/* the spec: BreadcrumbList on every page - a static page is two levels deep, no more. */}
      <JsonLd
        data={jsonld.graph([
          jsonld.webPage({ path, title: page.title }, ctx),
          ...(isAbout ? [jsonld.localBusiness({ path, hours: settings["store.hours"] }, ctx)] : []),
          jsonld.breadcrumb(
            [
              { name: t("tab.home"), href: ROUTES.home },
              { name: page.title, href: path },
            ],
            path,
            ctx,
          ),
        ])}
      />
      {isAbout ? (
        <AboutPage
          page={page}
          contact={settings["store.contact"]}
          hours={settings["store.hours"]}
          shipping={settings["shipping.copy"]}
          brands={aboutBrands}
        />
      ) : page.template === "store" ? (
        <StorePage page={page} store={settings["store.info"] as never} hours={settings["store.hours"]} />
      ) : page.template === "warranty" ? (
        <WarrantyPage page={page} />
      ) : page.template === "returns" ? (
        <ReturnsPage page={page} />
      ) : (
        // DECISION: contact / faq / installments fall back to the default body until their template
        // components land this milestone - the legacy content still renders and the URL still 200s,
        // which is what the 752-URL contract actually requires.
        <PageBody page={page} />
      )}
    </>
  );
}
