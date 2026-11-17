import { ROUTES, isShowcaseCard, noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/plp/ProductGrid";
import { RelatedRail } from "@/components/product/RelatedRail";
import { WishlistIsland } from "@/components/product/WishlistIsland";
import { t } from "@/i18n";
import { loadPlpFor, loadProductCards } from "@/server/loaders/catalog";

// DECISION: like /compare/, the body is a function of the URL and Postgres - a blocking route, not
// a streamed shell (see the note on compare/page.tsx; `instant = false` is Next's opt-out).
export const instant = false;

type Props = { searchParams: Promise<{ ids?: string }> };

/** the spec - the rail is the way out; eight cards fill it at every breakpoint. */
const RAIL_SIZE = 8;
const MAX_IDS = 60;

/** `?ids=1,2` - positive integers only, deduped, capped; anything else renders the empty state. */
function idsOf(raw: string | undefined): number[] {
  const out: number[] = [];
  for (const part of (raw ?? "").split(",")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length === MAX_IDS) break;
  }
  return out;
}

export function generateMetadata(): Metadata {
  // the spec: the legacy /wishlist/ URL keeps returning 200 and is noindex. Only the title and
  // the robots line are forwarded (an empty canonical is a URL a crawler would resolve).
  const meta = noindexMeta(t("shell.wishlist"));
  return { title: meta.title, robots: meta.robots };
}

export default async function WishlistPage({ searchParams }: Props) {
  const ids = idsOf((await searchParams).ids);
  // DECISION: «تازه‌ها» is the newest page of the whole catalogue (`sort: "newest"`), not the
  // `{ kind: "new" }` scope (its `published_at` term fails against the seeded database and this is
  // one of the 752 legacy URLs - it must return 200).
  const [cards, newest] = await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : loadProductCards(ids),
    loadPlpFor({ kind: "all" }, { scope: { kind: "all" }, sort: "newest" }),
  ]);

  return (
    <div className="grid gap-6">
      {/* Renders nothing; keeps the URL equal to the client store (bare /wishlist/ → ?ids=…). */}
      <WishlistIsland shown={ids} />
      {cards.length === 0 ? (
        // CompareEmpty's shape: title, one sentence, the primary way out.
        <div className="wrap chapter grid justify-items-center gap-4 text-center">
          <h1 className="d-2">{t("account.wishlist.empty")}</h1>
          <p className="t-lead text-ink-2">{t("account.wishlist.empty.body")}</p>
          <Link href={ROUTES.shop} className="btn btn--primary">
            {t("nav.shop")}
          </Link>
        </div>
      ) : (
        <section className="wrap chapter grid gap-4">
          <h1 className="d-2">{t("shell.wishlist")}</h1>
          <ProductGrid items={cards} />
        </section>
      )}
      {/* Design audit 2 Sep 2026: the rail is buyable, photographed items only - the home's rule. */}
      <RelatedRail title="account.wishlist.rail" items={newest.items.filter(isShowcaseCard).slice(0, RAIL_SIZE)} />
    </div>
  );
}
