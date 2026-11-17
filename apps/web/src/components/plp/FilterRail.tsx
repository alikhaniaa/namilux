// DECISION: the file carries the "use client" boundary although the header calls the rail
// "server-renderable". A boundary is per FILE, the price control is marked "(client)" by the same
// header, and a second file is out of scope here - so the rail is one small island. Nothing is
// lost: a client component is still rendered to HTML on the server, so every facet link is in the
// crawler's first response (F-008), and FilterSheet reuses this exact tree on the phone.
"use client";
import { AVAIL_KEYS, faInt, formatToman, plpUrl, withoutFilter } from "@namilux/core/client";
import type { AvailFilter, FacetOption, Facets, ImageRef, PlpState } from "@namilux/core/client";
import Link from "next/link";
import { useState } from "react";
import { Accordion } from "@/components/ui/Accordion";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Img } from "@/components/ui/Img";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

/** The three plain multi-value groups of the URL grammar. */
type ListGroup = "brand" | "collection" | "color";

const AVAIL_LABEL: Record<AvailFilter, FaKey> = {
  in: "plp.avail.in",
  sale: "plp.avail.sale",
  ready: "plp.avail.ready",
};

/** the spec: five groups, then the filterable attributes. First two open. */
const OPEN_GROUPS = 2;

const addToGroup = (state: PlpState, group: ListGroup, value: string): PlpState => {
  const next: PlpState = { ...state, page: 1 };
  next[group] = [...(state[group] ?? []), value];
  return next;
};

// Every facet control is a real link built with plpUrl (F-008), never a client-only mutation:
// removing goes through core's `withoutFilter`, so a chip can never mint a URL the parser reads
// back differently, and both directions reset `page`.
const groupHref = (basePath: string, state: PlpState, group: ListGroup, value: string): string =>
  plpUrl(
    basePath,
    state[group]?.includes(value) === true
      ? withoutFilter(state, group, value)
      : addToGroup(state, group, value),
  );

const availHref = (basePath: string, state: PlpState, key: AvailFilter): string =>
  plpUrl(
    basePath,
    state.avail?.includes(key) === true
      ? withoutFilter(state, "avail", key)
      : { ...state, avail: [...(state.avail ?? []), key], page: 1 },
  );

const attrHref = (basePath: string, state: PlpState, key: string, value: string): string => {
  const values = state.attr?.[key] ?? [];
  return plpUrl(
    basePath,
    values.includes(value)
      ? // url/plp-state addresses one keyed token as "<attrKey>:<attrValue>".
        withoutFilter(state, "attr", key + ":" + value)
      : { ...state, attr: { ...state.attr, [key]: [...values, value] }, page: 1 },
  );
};

/** The real finish when the option carries one; otherwise the chip is text only. */
function Swatch({ option }: { option: FacetOption }): React.ReactNode {
  if (option.swatch !== undefined) {
    return (
      <span className="swatch">
        <Img image={option.swatch} slot="thumb" alt="" className="size-full object-cover" />
      </span>
    );
  }
  if (option.hex !== undefined) {
    return <span className="swatch block" style={{ backgroundColor: option.hex }} />;
  }
  return null;
}

function ChipList({
  options,
  hrefOf,
  selected,
  swatch = false,
  logos,
  photo = false,
  row = false,
}: {
  options: readonly FacetOption[];
  hrefOf: (value: string) => string;
  selected: (value: string) => boolean;
  swatch?: boolean;
  /** value → brand mark; a tile with a mark is taller and shows it before the name */
  logos?: Record<string, ImageRef> | undefined;
  /** the `logos` are photos (collection covers): edge to edge instead of a padded well */
  photo?: boolean;
  /** one segmented row (availability): every option the same width, no counts */
  row?: boolean;
}): React.ReactNode {
  // Tile pass (3 Sep 2026): a facet option is a tile in a grid - label at the start, count at the
  // end, full-ink when selected (components.css `.facet-tiles`) - instead of a wrapping chip cloud.
  // Still a real link with aria-current (F-008; `aria-pressed` on a link is invalid).
  return (
    <ul
      className={row ? "facet-tiles facet-tiles--row" : "facet-tiles"}
      style={row ? ({ "--n": String(options.length) } as React.CSSProperties) : undefined}
    >
      {options.map((option) => {
        const on = selected(option.value);
        const logo = logos?.[option.value];
        return (
          <li key={option.value}>
            <Link
              href={hrefOf(option.value)}
              className={logo === undefined ? "facet-tile" : "facet-tile facet-brand"}
              aria-current={on ? "true" : undefined}
            >
              <span className="facet-tile__label">
                {logo === undefined ? null : (
                  <span className={photo ? "facet-logo facet-logo--photo" : "facet-logo"}>
                    <Img image={logo} slot="thumb" alt="" />
                  </span>
                )}
                {swatch ? <Swatch option={option} /> : null}
                <span>{option.label}</span>
              </span>
              <span className="n">{faInt(option.count)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Quick price bands (millions of Toman) above the two fields - one tap covers the common asks. */
const BAND_EDGES_M = [5, 20, 50, 100];
function QuickBands({ state, max, basePath }: { state: PlpState; max: number; basePath: string }): React.ReactNode {
  const M = 1_000_000;
  const edges = BAND_EDGES_M.filter((m) => m * M < max);
  if (edges.length === 0) return null;
  const bands: { label: string; min?: number; max?: number }[] = [];
  edges.forEach((m, i) => {
    if (i === 0) bands.push({ label: t("plp.price.upTo", { n: m }), max: m * M });
    else bands.push({ label: t("plp.price.between", { a: edges[i - 1] as number, b: m }), min: (edges[i - 1] as number) * M, max: m * M });
  });
  bands.push({ label: t("plp.price.above", { n: edges[edges.length - 1] as number }), min: (edges[edges.length - 1] as number) * M });
  const base = withoutFilter(state, "priceMin");
  return (
    <ul className="facet-bands">
      {bands.map((band) => {
        const on = state.priceMin === band.min && state.priceMax === band.max;
        const target: PlpState = on
          ? base
          : { ...base, ...(band.min === undefined ? {} : { priceMin: band.min }), ...(band.max === undefined ? {} : { priceMax: band.max }) };
        return (
          <li key={band.label}>
            <Link href={plpUrl(basePath, target)} className="facet-tile" aria-current={on ? "true" : undefined}>
              {band.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** «۲» after a group title: how many of its options are picked. */
function Picked({ n }: { n: number }): React.ReactNode {
  return n > 0 ? <span className="facet-picked">{faInt(n)}</span> : null;
}

/** "" = the field is empty (an open end); null = the reader typed something that is not an amount. */
function parseAmount(raw: string): number | "" | null {
  const s = raw.trim();
  if (s === "") return "";
  // `Field digits="fa"` shows Persian digits and emits Latin ones, so a valid amount is ASCII here.
  return /^\d{1,12}$/.test(s) ? Number.parseInt(s, 10) : null;
}

function PriceRange({
  state,
  price,
  basePath,
}: {
  state: PlpState;
  price: { min: number; max: number };
  basePath: string;
}): React.ReactNode {
  const fromUrl = String(state.priceMin ?? "") + "-" + String(state.priceMax ?? "");
  const fromState = (amount: number | undefined): string => (amount === undefined ? "" : String(amount));
  const [draft, setDraft] = useState({
    from: fromUrl,
    min: fromState(state.priceMin),
    max: fromState(state.priceMax),
  });
  // A navigation (a chip elsewhere, the back button) is the source of truth: when the URL's price
  // changes under the open panel the two inputs follow it instead of keeping a stale draft.
  if (draft.from !== fromUrl) {
    setDraft({ from: fromUrl, min: fromState(state.priceMin), max: fromState(state.priceMax) });
  }

  const min = parseAmount(draft.min);
  const max = parseAmount(draft.max);
  const invalid = min === null || max === null || (min !== "" && max !== "" && min > max);
  // Start from the state WITHOUT the price pair, so emptying a field really removes that end.
  const cleared = withoutFilter(state, "priceMin");
  const target: PlpState = {
    ...cleared,
    ...(min === "" || min === null ? {} : { priceMin: min }),
    ...(max === "" || max === null ? {} : { priceMax: max }),
  };

  return (
    <div className="facet-price">
      <QuickBands state={state} max={price.max} basePath={basePath} />
      {price.max > 0 ? (
        <p className="t-xs text-ink-3">
          {t("plp.price.min") +
            " " +
            formatToman(price.min) +
            " " +
            t("plp.price.max") +
            " " +
            formatToman(price.max) +
            " " +
            t("product.price.unit")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Field
          name="priceMin"
          label="plp.price.min"
          inputMode="numeric"
          digits="fa"
          value={draft.min}
          onChange={(v) => {
            setDraft({ ...draft, min: v });
          }}
        />
        <Field
          name="priceMax"
          label="plp.price.max"
          inputMode="numeric"
          digits="fa"
          value={draft.max}
          onChange={(v) => {
            setDraft({ ...draft, max: v });
          }}
        />
      </div>
      {/* «اعمال» is a link too: the range the reader typed is a URL like every other facet. */}
      <Button variant="secondary" size="sm" href={plpUrl(basePath, target)} disabled={invalid}>
        {t("plp.apply")}
      </Button>
    </div>
  );
}

export function FilterRail({
  state,
  facets,
  basePath,
  brandLogos,
  collectionCovers,
}: {
  state: PlpState;
  facets: Facets;
  basePath: string;
  brandLogos?: Record<string, ImageRef> | undefined;
  collectionCovers?: Record<string, ImageRef> | undefined;
}): React.ReactNode {
  const groups: { id: string; title: string; content: React.ReactNode; meta?: React.ReactNode }[] = [];

  if (facets.brand.length > 0) {
    groups.push({
      id: "brand",
      title: t("plp.facet.brand"),
      meta: <Picked n={state.brand?.length ?? 0} />,
      content: (
        <ChipList
          options={facets.brand}
          hrefOf={(value) => groupHref(basePath, state, "brand", value)}
          selected={(value) => state.brand?.includes(value) === true}
          logos={brandLogos}
        />
      ),
    });
  }

  if (facets.collection.length > 0) {
    groups.push({
      id: "collection",
      title: t("plp.facet.collection"),
      meta: <Picked n={state.collection?.length ?? 0} />,
      content: (
        <ChipList
          options={facets.collection}
          hrefOf={(value) => groupHref(basePath, state, "collection", value)}
          selected={(value) => state.collection?.includes(value) === true}
          logos={collectionCovers}
          photo
        />
      ),
    });
  }

  // EDGE CASE: a scope with no priced products has price {0,0} - there is nothing to range over,
  // but a stale ?price= in the URL must still be removable, so the group stays while it is selected.
  if (facets.price.max > 0 || state.priceMin !== undefined || state.priceMax !== undefined) {
    groups.push({
      id: "price",
      title: t("plp.facet.price"),
      meta: <Picked n={state.priceMin !== undefined || state.priceMax !== undefined ? 1 : 0} />,
      content: <PriceRange state={state} price={facets.price} basePath={basePath} />,
    });
  }

  if (facets.color.length > 0) {
    groups.push({
      id: "color",
      title: t("plp.facet.color"),
      meta: <Picked n={state.color?.length ?? 0} />,
      content: (
        <ChipList
          options={facets.color}
          hrefOf={(value) => groupHref(basePath, state, "color", value)}
          selected={(value) => state.color?.includes(value) === true}
          swatch
        />
      ),
    });
  }

  // A zero-count availability that is already in the URL stays, so the reader can undo it.
  const availOptions: FacetOption[] = AVAIL_KEYS.filter(
    (key) => facets.avail[key] > 0 || state.avail?.includes(key) === true,
  ).map((key) => ({ value: key, label: t(AVAIL_LABEL[key]), count: facets.avail[key] }));
  if (availOptions.length > 0) {
    groups.push({
      id: "avail",
      title: t("plp.facet.availability"),
      meta: <Picked n={state.avail?.length ?? 0} />,
      content: (
        <ChipList
          options={availOptions}
          hrefOf={(value) => availHref(basePath, state, value as AvailFilter)}
          selected={(value) => state.avail?.includes(value as AvailFilter) === true}
          row
        />
      ),
    });
  }

  for (const attr of facets.attrs) {
    groups.push({
      id: "attr-" + attr.key,
      // The attribute's own label carries its unit when it has one.
      title: attr.unit === null ? attr.label : attr.label + " (" + attr.unit + ")",
      meta: <Picked n={state.attr?.[attr.key]?.length ?? 0} />,
      content: (
        <ChipList
          options={attr.options}
          hrefOf={(value) => attrHref(basePath, state, attr.key, value)}
          selected={(value) => state.attr?.[attr.key]?.includes(value) === true}
        />
      ),
    });
  }

  // EDGE CASE: scope "ids" (compare/wishlist) and an empty catalogue have no facets at all - the
  // rail renders nothing rather than an empty frame.
  if (groups.length === 0) return null;

  return (
    // <nav>, not a <div>: every control here navigates to another listing URL.
    <nav aria-label={t("plp.filter")}>
      <Accordion items={groups.map((group, i) => ({ ...group, defaultOpen: i < OPEN_GROUPS }))} />
    </nav>
  );
}
