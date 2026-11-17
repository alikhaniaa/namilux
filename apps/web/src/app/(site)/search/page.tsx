import { ROUTES, noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchResults } from "@/components/search/SearchResults";
import { t } from "@/i18n";
import { loadNav } from "@/server/loaders/nav";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

type Props = { searchParams: Promise<{ q?: string }> };

/** parsePlpState caps a facet value at 64 chars; a query is held to the same measure. */
const MAX_Q = 64;

function queryOf(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_Q);
}

export function generateMetadata(): Metadata {
  // the spec: /search/ is noindex. `noindexMeta` also returns an empty canonical and an empty OG
  // block; only the title and the robots line are forwarded - a page that asks not to be indexed
  // must not also publish `<link rel="canonical" href="">`, which is a URL a crawler would resolve.
  const meta = noindexMeta(t("search.title"));
  return { title: meta.title, robots: meta.robots };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = queryOf((await searchParams).q);
  const nav = await loadNav();

  // the spec: there is no server search endpoint - the index is a client fetch and the same
  // engine that powers the overlay runs here with no product limit. The server only renders the
  // shell, so this page stays one cacheable payload plus one shared JSON file.
  if (q === "") {
    // DECISION: the idle state of the overlay (frequent chips, brands, recent) cannot be reused
    // here - `SearchIdle` takes an `onPick` callback, and a server component may not hand a
    // function to a client island. A query-less /search/ is therefore the empty state with the
    // collections way-out, which is what §9.4's idle state exists to offer anyway.
    return (
      <EmptyState
        title="search.title"
        body="search.empty.body"
        primary={{ key: "nav.shop", href: ROUTES.shop }}
        rail={{
          title: "search.collections",
          collections: nav.collections.map((c) => ({ slug: c.slug, name: c.name, href: c.href })),
        }}
      />
    );
  }

  return (
    <>
      <div className="wrap section grid gap-4">
        <h1 className="d-1">{t("search.title")}</h1>
        {/* The query is echoed so a shared or bookmarked result page says what it searched for. */}
        <p className="t-sm text-ink-3">«{q}»</p>
        <SearchResults q={q} full brands={nav.brands} collections={nav.collections} />
      </div>

      {/* the spec: the way out is always visible. DECISION: the collections rail is rendered
          under the results rather than only on zero results - the count is known to the client
          island alone, and the zero-result sentence «…یا از دسته‌ها شروع کنید» promises exactly
          these chips right below it. */}
      <section className="wrap section grid gap-4">
        <h2 className="d-3">{t("search.collections")}</h2>
        <ul className="flex flex-wrap gap-2">
          {nav.collections.map((c) => (
            <li key={c.slug}>
              <Link href={c.href} className="chip">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
