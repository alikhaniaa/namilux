import { MAX_COMPARE_DESKTOP, isShowcaseCard, noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import { CompareEmpty } from "@/components/compare/CompareEmpty";
import { CompareTable } from "@/components/compare/CompareTable";
import { t } from "@/i18n";
import { loadCompareData, loadPlpFor } from "@/server/loaders/catalog";

// DECISION: a blocking route, not a streamed shell. `cacheComponents` asks every route to
// prerender a static shell and stream the rest, but this page's whole body is a function of the
// URL (params/searchParams) and of Postgres - there is no part of it that is knowable at build
// time, and the spec does not describe a shell-plus-stream model for the catalogue: it renders
// the page from Postgres inside `use cache` and lets the CDN cache the finished HTML per URL
// (s-maxage 300, swr 86400). `instant = false` is Next's documented opt-out for exactly that
// shape; without it Next reports `blocking-prerender-runtime` on every request.
export const instant = false;

type Props = { searchParams: Promise<{ ids?: string }> };

/** the spec - an empty state always ends in a rail; eight cards fill it at every breakpoint. */
const RAIL_SIZE = 8;

/**
 * `?ids=1,2` - positive integers only, deduped, capped at the desktop maximum before the loader
 * (which caps again). Anything else is dropped rather than rejected: a mangled share link must
 * render the empty state, never a 500.
 */
function idsOf(raw: string | undefined): number[] {
  const out: number[] = [];
  for (const part of (raw ?? "").split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length === MAX_COMPARE_DESKTOP) break;
  }
  return out;
}

export function generateMetadata(): Metadata {
  // the spec: noindex + no-store. The `no-store` half is set by proxy.ts, which lists /compare/
  // among the dynamic prefixes; only the title and robots line are forwarded here (an empty
  // canonical is a URL a crawler would resolve - see the same note on /search/).
  const meta = noindexMeta(t("compare.title"));
  return { title: meta.title, robots: meta.robots };
}

export default async function ComparePage({ searchParams }: Props) {
  const ids = idsOf((await searchParams).ids);
  // The rail is the same first page of recommended products the shop opens with - a way out that
  // never depends on what the reader failed to select. Started first so it runs beside the details.
  const railPromise = loadPlpFor({ kind: "all" }, { scope: { kind: "all" } });
  const products = ids.length === 0 ? [] : await loadCompareData(ids);
  const rail = await railPromise;

  return (
    <>
      {/* CompareTable renders nothing when the list is empty; it stays mounted so it can adopt the
          ids the client compare store holds (the header control links to a bare /compare/) and
          rewrite the URL to /compare/?ids=… - the "or the client compare store on mount" half of
          this page's contract. */}
      <CompareTable products={products} />
      {/* Design audit 2 Sep 2026: the way out is photographed, buyable products only (the home's rule). */}
      {products.length === 0 ? <CompareEmpty rail={rail.items.filter(isShowcaseCard).slice(0, RAIL_SIZE)} /> : null}
    </>
  );
}
