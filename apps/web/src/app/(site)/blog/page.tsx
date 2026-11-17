import { buildMetadata, jsonld, postUrl } from "@namilux/core";
import type { Metadata } from "next";
import { ArticleCard } from "@/components/journal/ArticleCard";
import { Pagination } from "@/components/plp/Pagination";
import { JsonLd } from "@/components/ui/JsonLd";
import { t } from "@/i18n";
import { loadPosts } from "@/server/loaders/content";
import { loadLegacyHead, loadSettings } from "@/server/loaders/settings";
import { env } from "@/env";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

type Props = { searchParams: Promise<{ page?: string }> };

function pageOf(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = pageOf((await searchParams).page);
  const settings = await loadSettings();
  const seo = settings["seo.defaults"];
  // the spec: `?page=N` is indexable with a self-canonical; page 1 is `/blog/` itself.
  // DECISION: page 1's title is the verbatim legacy «بلاگ - نامی لوکس» from `seo_snapshots`; a
  // deeper page is a new URL the legacy site never had, so it takes the journal's own name. The
  // section is «ژورنال» everywhere in the UI - only the <title> keeps the old word.
  const legacy = page > 1 ? null : await loadLegacyHead("/blog/");
  const meta = buildMetadata(
    {
      path: page > 1 ? `/blog/?page=${String(page)}` : "/blog/",
      title: legacy?.title ?? t("journal.title"),
      description: legacy?.description ?? null,
      robots: legacy?.robots ?? "index, follow",
      ogType: "website",
      ogImage: null,
      origin: env.SITE_ORIGIN,
      siteName: seo.siteName,
      titleTemplate: seo.titleTemplate,
    },
    { defaultOgKey: seo.defaultOgKey, mediaUrl: (key) => `${env.SITE_ORIGIN}/media/${key}` },
  );
  return {
    title: meta.title,
    description: meta.description,
    alternates: meta.alternates,
    robots: meta.robots,
    openGraph: meta.openGraph,
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const page = pageOf((await searchParams).page);
  const [posts, settings] = await Promise.all([loadPosts(page), loadSettings()]);
  const seo = settings["seo.defaults"];

  const ctx = {
    origin: env.SITE_ORIGIN,
    siteName: seo.siteName,
    store: { ...settings["store.info"], ...settings["store.contact"], instagram: settings["store.social"].instagram },
    mediaUrl: (key: string) => `${env.SITE_ORIGIN}/media/${key}`,
  };
  const graph = jsonld.graph([
    jsonld.collection(
      { path: "/blog/", name: t("journal.title") },
      posts.items.map((p) => ({ url: `${env.SITE_ORIGIN}${postUrl(p.slug)}`, name: p.title })),
      ctx,
    ),
    // the spec: BreadcrumbList on every page - the legacy head of /blog/ carried one and the
    // CollectionPage node references it by @id.
    jsonld.breadcrumb(
      [
        { name: t("tab.home"), href: "/" },
        { name: t("journal.title"), href: "/blog/" },
      ],
      "/blog/",
      ctx,
    ),
  ]);

  return (
    <>
      <JsonLd data={graph} />
      <div className="wrap section grid gap-6">
        <h1 className="d-1">{t("journal.title")}</h1>
        <div className="journal-index grid gap-8 md:grid-cols-3">
          {posts.items.map((post) => (
            <ArticleCard key={post.id} post={post} />
          ))}
        </div>
      </div>
      <Pagination page={posts.page} pageSize={posts.pageSize} total={posts.total} basePath="/blog/" state={{}} />
    </>
  );
}
