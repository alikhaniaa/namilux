"use client";
import { formatToman, mediaUrl, productUrl } from "@namilux/core/client";
import Link from "next/link";
import { useEffect } from "react";
import { pushRecent, useRecent } from "@/components/state/recent-store";
import { useSearchIndex } from "@/components/search/useSearchIndex";
import { Rail } from "@/components/ui/Rail";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { t } from "@/i18n";

const MIN_ROWS = 2;

export function RecentlyViewed({ currentId }: { currentId?: number }): React.ReactNode {
  useEffect(() => {
    if (currentId !== undefined) pushRecent(currentId);
  }, [currentId]);

  const ids = useRecent().filter((id) => id !== currentId);
  // recent-store's own DECISION: there is no endpoint that resolves a list of ids into cards, so
  // the rail reads the client search index - which already carries name, price and image key and
  // is fetched once per session for the overlay anyway.
  const { index } = useSearchIndex(ids.length > 0);

  if (index === null || ids.length < MIN_ROWS) return null;
  const byId = new Map(index.map((e) => [e.id, e]));
  const rows = ids.map((id) => byId.get(id)).filter((e) => e !== undefined);
  if (rows.length < MIN_ROWS) return null;

  return (
    <section className="section grid gap-4 below-fold">
      <div className="wrap">
        <SectionHeader title={t("product.recent")} as="h2" />
      </div>
      <Rail ariaLabel={t("product.recent")} itemWidth="card">
        {rows.map((e) => (
          <li key={e.id}>
            <Link href={productUrl(e.slug)} className="card grid gap-2">
              <span className="plate">
                {e.i === undefined ? null : <img src={mediaUrl(e.i)} alt="" loading="lazy" width={176} height={220} />}
              </span>
              <span className="body">
                <span className="name">{e.dn}</span>
                {/* The index carries price 0 for the 283 on-request products. */}
                <span className="price price--sm">
                  {e.p === 0 ? t("product.onRequest") : formatToman(e.p)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </Rail>
    </section>
  );
}
