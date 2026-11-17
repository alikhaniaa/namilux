"use client";
import { faInt, mediaUrl, productUrl } from "@namilux/core/client";
import type { NavBrand, NavCollection, SearchIndexEntry } from "@namilux/core/client";
import Link from "next/link";
import { useMemo } from "react";
import { useSearchIndex } from "./useSearchIndex";
import { useRecent } from "@/components/state/recent-store";
import { Chip } from "@/components/ui/Chip";
import { Img } from "@/components/ui/Img";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";

/** the spec: four tiles, three recent rows - the idle state is a shortcut list, not a page. */
const COLLECTION_TILES = 4;
const RECENT_ROWS = 3;

/**
 * DECISION: the recently-viewed rows are resolved from the client index, as `state/recent-store.ts`
 * decided (no endpoint returns cards by id). The hook is already loaded by the overlay, so this is
 * a read of the module-level cache, not a second request; before it arrives the section is simply
 * absent rather than a row of skeletons the reader never asked for.
 */
function useRecentEntries(max: number): SearchIndexEntry[] {
  const { index } = useSearchIndex(true);
  const ids = useRecent();
  return useMemo(() => {
    if (index === null || ids.length === 0) return [];
    const byId = new Map(index.map((e) => [e.id, e]));
    const out: SearchIndexEntry[] = [];
    for (const id of ids) {
      const entry = byId.get(id);
      if (entry !== undefined) out.push(entry);
      if (out.length === max) break;
    }
    return out;
  }, [index, ids, max]);
}

/** A 56 px normalized thumb from the index's rendition key (the spec: `i` is a storage key). */
function Thumb({ imageKey }: { imageKey: string | undefined }): React.ReactNode {
  return (
    <span className="plate size-14 shrink-0">
      {imageKey === undefined ? null : (
        <img src={mediaUrl(imageKey)} alt="" width={56} height={56} loading="lazy" decoding="async" />
      )}
    </span>
  );
}

export function SearchIdle({
  frequent,
  brands,
  collections,
  onPick,
}: {
  frequent: string[];
  brands: NavBrand[];
  collections: NavCollection[];
  onPick: (q: string) => void;
}): React.ReactNode {
  const recent = useRecentEntries(RECENT_ROWS);
  const tiles = collections.slice(0, COLLECTION_TILES);

  // Design audit 2 Sep 2026: on desktop the idle state is two columns - the brand directory beside
  // the frequent searches, the collection tiles and the recent rows - instead of a bare list in a
  // 1440 px takeover with everything else below the fold. Phones keep the single column.
  return (
    <div className="search-idle pb-10">
      <div className="search-idle__col">
        {brands.length === 0 ? null : (
          <section className="tier-block">
            <h2 className="label-fa text-ink-3">{t("search.brands")}</h2>
            <ul>
              {brands.map((b) => (
                <li key={b.slug}>
                  <Link href={b.href} className="flex h-13 items-center gap-3">
                    {b.image === null ? null : (
                      <span className="plate size-[40px] shrink-0">
                        <Img image={b.image} slot="thumb" alt="" />
                      </span>
                    )}
                    <span className="t-body grow">{b.name}</span>
                    <span className="t-xs text-ink-3">{faInt(b.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="search-idle__col">
      {/* Frequent searches - a chip fills the field instead of navigating, so the reader can edit it. */}
      {frequent.length === 0 ? null : (
        <section className="tier-block">
          <h2 className="label-fa text-ink-3">{t("search.frequent")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {frequent.map((q) => (
              <Chip key={q} onToggle={() => { onPick(q); }}>
                {q}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {tiles.length === 0 ? null : (
        <section className="tier-block">
          <h2 className="label-fa text-ink-3">{t("search.collections")}</h2>
          <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map((c) => (
              <li key={c.slug}>
                <Link href={c.href} className="grid gap-2">
                  <span className="plate block">
                    {c.image === null ? null : <Img image={c.image} slot="cover" alt="" />}
                  </span>
                  <span className="t-sm flex items-center gap-2">
                    <span className="grow">{c.name}</span>
                    <span className="t-xs text-ink-3">{faInt(c.count)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length === 0 ? null : (
        <section className="tier-block">
          <h2 className="label-fa text-ink-3">{t("search.recent")}</h2>
          <ul>
            {recent.map((e) => (
              <li key={e.id}>
                <Link href={productUrl(e.slug)} className="flex items-center gap-3 py-2">
                  <Thumb imageKey={e.i} />
                  <span className="t-sm grow">{e.dn}</span>
                  {e.p > 0 ? (
                    <span className="tnum ms-auto shrink-0">
                      <Price amount={e.p} size="sm" />
                    </span>
                  ) : (
                    <span className="t-xs text-ink-3 ms-auto shrink-0">{t("product.onRequest")}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
    </div>
  );
}
