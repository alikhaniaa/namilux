import { noindexMeta } from "@namilux/core";
import type { Banner, ProductCard } from "@namilux/core";
import type { Metadata } from "next";
import { IgGrid } from "@/components/ig/IgGrid";
import { t } from "@/i18n";
import { loadPlpFor } from "@/server/loaders/catalog";
import { loadBanners } from "@/server/loaders/content";

/** F-076: the campaign cards first, then the last twelve ready-to-ship products. */
const READY_CARDS = 12;

export function generateMetadata(): Metadata {
  // the spec: /ig/ is noindex (and no-store). Only the title and robots line are forwarded - an
  // empty canonical is a URL a crawler would resolve.
  const meta = noindexMeta(t("shell.wordmark"));
  return { title: meta.title, robots: meta.robots };
}

export default async function IgLandingPage() {
  const [banners, ready] = await Promise.all([
    loadBanners("ig_landing"),
    // «آمادهٔ ارسال» = the buyable, priced products, newest first - the same avail facet the home
    // rail and the shop chip use, minted through the PLP grammar rather than a bespoke query.
    loadPlpFor({ kind: "all" }, { scope: { kind: "all" }, avail: ["ready"], sort: "newest" }),
  ]);

  const cards: ({ kind: "product"; product: ProductCard } | { kind: "campaign"; banner: Banner })[] = [
    ...banners.map((banner) => ({ kind: "campaign" as const, banner })),
    ...ready.items.slice(0, READY_CARDS).map((product) => ({ kind: "product" as const, product })),
  ];

  return (
    <div className="wrap section grid gap-5">
      {/* A link-in-bio landing introduces the shop, so the wordmark is the page's one heading. */}
      <h1 className="d-1">{t("shell.wordmark")}</h1>
      <IgGrid cards={cards} />
    </div>
  );
}
