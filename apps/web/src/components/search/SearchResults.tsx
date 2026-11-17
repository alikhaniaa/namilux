"use client";
import { mediaUrl, productUrl, searchUrl } from "@namilux/core/client";
import type { NavBrand, NavCollection, SearchIndexEntry } from "@namilux/core/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { highlight, OVERLAY_PRODUCT_LIMIT, search } from "./search-engine";
import { useSearchIndex } from "./useSearchIndex";
import { bindSearchKeyboard } from "./search-keyboard";
import { Price } from "@/components/ui/Price";
import { Skeleton } from "@/components/ui/Skeleton";
import { t } from "@/i18n";
import { track } from "@/lib/analytics-client";

/**
 * DECISION: the combobox is split across two files by the two headers - the input belongs to
 * SearchOverlay, the listbox to this component - so the ids that wire them together
 * (`aria-controls`, `aria-activedescendant`) are a shared constant instead of a literal repeated in
 * both. This file owns the listbox, so it owns the names.
 */
export const SEARCH_INPUT_ID = "nl-search-input";
export const SEARCH_LISTBOX_ID = "nl-search-listbox";
const OPTION_ID = (i: number): string => `nl-search-option-${String(i)}`;

// DECISION: `brands`/`collections` are added as OPTIONAL props (the header's required pair `{ q,
// full? }` is unchanged, so every documented call site still type-checks). the spec groups the
// results under برندها / مجموعه‌ها / محصولات and the engine takes those lists in `opts`; the index
// rows carry a brand NAME and collection SLUGS only, so without them the two groups could not be
// labelled or linked at all.
const NO_BRANDS: NavBrand[] = [];
const NO_COLLECTIONS: NavCollection[] = [];

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

function Highlighted({ text, q }: { text: string; q: string }): React.ReactNode {
  const runs = highlight(text, q);
  return (
    <>
      {runs.map((run, i) =>
        run.hit ? (
          // Design audit 2 Sep 2026: a match is marked by weight and a hairline, never the accent.
          <mark key={`${String(i)}:${run.text}`} className="search-hit">
            {run.text}
          </mark>
        ) : (
          <span key={`${String(i)}:${run.text}`}>{run.text}</span>
        ),
      )}
    </>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }): React.ReactNode {
  return <h2 className="label-fa text-ink-3 pt-4 pb-2">{children}</h2>;
}

export function SearchResults({
  q,
  full = false,
  brands = NO_BRANDS,
  collections = NO_COLLECTIONS,
}: {
  q: string;
  full?: boolean;
  brands?: NavBrand[];
  collections?: NavCollection[];
}): React.ReactNode {
  const { index, loading } = useSearchIndex(true);
  const router = useRouter();
  const [active, setActive] = useState(-1);

  const results = useMemo(
    () =>
      search(index ?? [], q, {
        limit: full ? Number.POSITIVE_INFINITY : OVERLAY_PRODUCT_LIMIT,
        brands,
        collections,
      }),
    [index, q, full, brands, collections],
  );

  // The three groups are one flat option list for the keyboard, in DOM order.
  const hrefs = useMemo(
    () => [
      ...results.brands.map((b) => b.href),
      ...results.collections.map((c) => c.href),
      ...results.products.map((p) => productUrl(p.slug)),
    ],
    [results],
  );
  const collectionsAt = results.brands.length;
  const productsAt = collectionsAt + results.collections.length;

  // A new query starts with nothing active: Enter must then submit the query, not open whatever row
  // happened to sit at the old index.
  useEffect(() => {
    setActive(-1);
  }, [q, hrefs]);

  useEffect(() => {
    if (full || hrefs.length === 0) return undefined;
    const owner = document.getElementById(SEARCH_INPUT_ID);
    if (!(owner instanceof HTMLInputElement)) return undefined;
    return bindSearchKeyboard(owner, { query: q, hrefs, active,
      move: (direction) => setActive((at) => direction === 1 ? (at + 1) % hrefs.length : at <= 0 ? hrefs.length - 1 : at - 1),
      navigate: (href) => router.push(href),
    });
  }, [q, full, hrefs, active, router]);

  // `aria-activedescendant` must sit on the element that holds DOM focus - the input, which belongs
  // to the overlay - so it is written imperatively here, where the active row is known.
  useEffect(() => {
    if (full) return undefined;
    const owner = document.getElementById(SEARCH_INPUT_ID);
    if (owner === null) return undefined;
    if (active < 0) {
      owner.removeAttribute("aria-activedescendant");
      return undefined;
    }
    owner.setAttribute("aria-activedescendant", OPTION_ID(active));
    document.getElementById(OPTION_ID(active))?.scrollIntoView({ block: "nearest" });
    return () => {
      owner.removeAttribute("aria-activedescendant");
    };
  }, [active, full]);

  const rowClass = (i: number): string =>
    // tile pass: every row is a tile; the keyboard-active one carries aria-selected (styled in css)
    `search-row flex items-center gap-3 ${i === active ? "is-active" : ""}`.trimEnd();

  const optionAttrs = (i: number): { id?: string; role?: "option"; "aria-selected"?: boolean } => full ? {} : ({
    id: OPTION_ID(i),
    role: "option",
    "aria-selected": i === active,
  });

  // the spec: a query that finds nothing is a merchandising signal - one beacon
  // per distinct zero-result term, fired only once the index has actually been searched.
  useEffect(() => {
    if (loading || index === null || q.trim() === "" || hrefs.length > 0) return;
    track("search", { q: q.trim().slice(0, 80), zero: 1 });
  }, [q, hrefs.length, loading, index]);

  if (index === null && loading) {
    return (
      // The default "line" aspect is used rather than a 56 px block: passing a height utility would
      // fight Skeleton's own `h-[1lh]` (same specificity, undefined winner).
      <div className="grid gap-4 pt-4 pb-10" aria-busy="true" aria-label={t("a11y.loading")}>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (hrefs.length === 0) {
    return (
      <div className="block">
        <p className="t-body">{t("search.empty", { q })}</p>
        <p className="t-sm text-ink-3">{t("search.empty.body")}</p>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div role={full ? undefined : "listbox"} id={full ? undefined : SEARCH_LISTBOX_ID} aria-label={t("search.title")}>
        {results.brands.length === 0 ? null : (
          <div role="group" aria-label={t("search.results.brands")}>
            <GroupHeading>{t("search.results.brands")}</GroupHeading>
            {results.brands.map((b, i) => (
              <Link key={b.slug} href={b.href} className={rowClass(i)} {...optionAttrs(i)}>
                <span className="t-body grow">
                  <Highlighted text={b.name} q={q} />
                </span>
              </Link>
            ))}
          </div>
        )}

        {results.collections.length === 0 ? null : (
          <div role="group" aria-label={t("search.results.collections")}>
            <GroupHeading>{t("search.results.collections")}</GroupHeading>
            {results.collections.map((c, i) => (
              <Link
                key={c.slug}
                href={c.href}
                className={rowClass(collectionsAt + i)}
                {...optionAttrs(collectionsAt + i)}
              >
                <span className="t-body grow">
                  <Highlighted text={c.name} q={q} />
                </span>
              </Link>
            ))}
          </div>
        )}

        {results.products.length === 0 ? null : (
          <div role="group" aria-label={t("search.results.products")}>
            <GroupHeading>{t("search.results.products")}</GroupHeading>
            {results.products.map((p: SearchIndexEntry, i) => (
              <Link
                key={p.id}
                href={productUrl(p.slug)}
                className={rowClass(productsAt + i)}
                {...optionAttrs(productsAt + i)}
              >
                <Thumb imageKey={p.i} />
                <span className="grow">
                  <span className="t-sm line-clamp-2 block">
                    <Highlighted text={p.dn} q={q} />
                  </span>
                  <span className={p.s ? "stock stock--ok" : "stock stock--out"}>
                    {t(p.s ? "product.stock.in" : "product.stock.out")}
                  </span>
                </span>
                {p.p > 0 ? (
                  <span className="tnum shrink-0">
                    <Price amount={p.p} size="sm" />
                  </span>
                ) : (
                  <span className="t-xs text-ink-3 shrink-0">{t("product.onRequest")}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* «مشاهدهٔ همهٔ n نتیجه» - only when the overlay is actually holding results back. */}
      {full || results.total <= results.products.length ? null : (
        <Link href={searchUrl(q)} className="link-under t-sm mt-4 inline-block">
          {t("search.viewAll", { n: results.total })}
        </Link>
      )}
    </div>
  );
}
