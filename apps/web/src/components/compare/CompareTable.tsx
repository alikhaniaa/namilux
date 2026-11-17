"use client";
import { ROUTES, faDigits, productUrl } from "@namilux/core/client";
import type { ProductDetail, SpecGroup } from "@namilux/core/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompare } from "@/components/state/compare-store";
import { Bdi } from "@/components/ui/Bdi";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { Img } from "@/components/ui/Img";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";

/**
 * v2 §6.6: the second column must always peek, so a reader knows the table scrolls, and every
 * column snaps to the start edge. The width is the DECIDED `min(72vw, 280px)`.
 */
const COLUMN: React.CSSProperties = {
  inlineSize: "min(72vw, 280px)",
  minInlineSize: "min(72vw, 280px)",
  scrollSnapAlign: "start",
};

/** The sticky label column keeps a fixed measure so the peek of the next column is predictable. */
const LABEL_COLUMN: React.CSSProperties = { inlineSize: "min(34vw, 176px)", minInlineSize: "min(34vw, 176px)" };

/**
 * v2 §6.6 bug 2: `position: sticky; inset-inline-start: 0` with an OPAQUE ground and a `--line`
 * edge - without the ground the values scroll under the labels and the column becomes unreadable.
 */
const STICKY_LABEL = "sticky start-0 z-10 border-e border-line t-sm p-3 text-start align-top font-medium text-ink-2";

/** An attribute one product does not declare: an em dash, never a blank cell (a blank reads as "no data yet"). */
const ABSENT = "ثبت نشده";

type Cell = { id: number; key: string; node: React.ReactNode };
type Row = { key: string; label: string; cells: Cell[] };

function empty(): React.ReactNode {
  return <span className="text-ink-3">{ABSENT}</span>;
}

/** All spec rows of a product flattened to label → value; the first group that declares a label wins. */
function specValues(specs: SpecGroup[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of specs) {
    for (const row of group.rows) {
      if (!out.has(row.label)) out.set(row.label, row.value);
    }
  }
  return out;
}

function compareHref(ids: number[]): string {
  return ids.length === 0 ? ROUTES.compare : `${ROUTES.compare}?ids=${ids.join(",")}`;
}

export function CompareTable({ products }: { products: ProductDetail[] }): React.ReactNode {
  const router = useRouter();
  const { ids: storedIds, has, toggle } = useCompare();
  const [onlyDiff, setOnlyDiff] = useState(false);
  // The URL is adopted from the store at most once per mount, so a stored id that no longer
  // resolves to a product (archived while it sat in localStorage) cannot loop the router.
  const adopted = useRef(false);

  // DECISION: this is the "or the client compare store on mount" half of the page's contract
  // (app/(site)/compare/page.tsx). The header control links to a bare `/compare/`, and the ids only
  // exist in localStorage, so when the server rendered nothing and the store is not empty the URL
  // is rewritten to `/compare/?ids=…` - one replace, no history entry, and the page then loads the
  // details server-side exactly as it does for a shared link.
  useEffect(() => {
    if (adopted.current) return;
    if (products.length > 0 || storedIds.length === 0) return;
    adopted.current = true;
    router.replace(compareHref(storedIds));
  }, [products.length, storedIds, router]);

  const remove = useCallback(
    (id: number): void => {
      // DECISION: `toggle` is only called when the id IS in the store - it is a toggle, so calling
      // it for an id that arrived from a shared URL would ADD the product the reader just removed.
      if (has(id)) toggle(id);
      router.replace(compareHref(products.filter((p) => p.id !== id).map((p) => p.id)));
    },
    [has, toggle, router, products],
  );

  const rows = useMemo<Row[]>(() => {
    const maps = products.map((p) => specValues(p.specs));
    const built: Row[] = [];

    // The four commerce rows come first: they are what a shopper compares before any attribute.
    built.push({
      key: "brand",
      label: t("plp.facet.brand"),
      cells: products.map((p) => ({
        id: p.id,
        key: p.brand === null ? "" : p.brand.name,
        node: p.brand === null ? empty() : <Bdi text={p.brand.name} />,
      })),
    });
    built.push({
      key: "price",
      // DECISION: fa.ts has no bare «قیمت» key and this task may not extend it, so the price facet's
      // label is reused - it is the word the same reader saw on the filter rail.
      label: t("plp.facet.price"),
      cells: products.map((p) => ({
        id: p.id,
        key: p.onRequest || p.price === 0 ? "on-request" : String(p.price),
        node:
          p.onRequest || p.price === 0 ? (
            <span className="t-sm text-ink-3">{t("product.onRequest")}</span>
          ) : (
            <Price amount={p.price} compareAt={p.compareAt ?? null} size="sm" />
          ),
      })),
    });
    built.push({
      key: "stock",
      label: t("plp.facet.availability"),
      cells: products.map((p) => ({
        id: p.id,
        key: p.available ? (p.lowStock ? "low" : "in") : "out",
        node: (
          <span className={p.available ? "stock stock--ok" : "stock stock--out"}>
            {t(p.available ? "product.stock.in" : "product.stock.out")}
          </span>
        ),
      })),
    });
    built.push({
      key: "warranty",
      label: t("product.acc.warranty"),
      cells: products.map((p) => {
        const months = p.warrantyMonths;
        const text = months === undefined ? (p.warrantyText ?? "") : t("product.trust.warranty", { n: months });
        return { id: p.id, key: text, node: text === "" ? empty() : <Bdi text={faDigits(text)} /> };
      }),
    });

    // Then the union of every spec label, in the order the first product that declares it lists it - 
    // a stable order no product can reshuffle for the others.
    const labels: string[] = [];
    for (const map of maps) {
      for (const label of map.keys()) if (!labels.includes(label)) labels.push(label);
    }
    for (const label of labels) {
      built.push({
        key: `spec:${label}`,
        label,
        cells: products.map((p, i) => {
          const value = maps[i]?.get(label) ?? "";
          // v2 §6.6 bug 1: real values, never a fused spec string; Latin runs isolated, digits Persian.
          return { id: p.id, key: value, node: value === "" ? empty() : <Bdi text={faDigits(value)} /> };
        }),
      });
    }
    return built;
  }, [products]);

  // «فقط تفاوت‌ها»: on a 20-row table where 14 rows are identical this is the feature (v2 §6.6).
  const visible = useMemo(
    () => (onlyDiff ? rows.filter((row) => new Set(row.cells.map((c) => c.key)).size > 1) : rows),
    [rows, onlyDiff],
  );

  // EDGE CASE: nothing to compare - the page renders CompareEmpty instead; this component only
  // stays mounted so the effect above can adopt the store's ids.
  if (products.length === 0) return null;

  return (
    <div className="wrap section grid gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="d-1">{t("compare.title")}</h1>
        <Chip
          pressed={onlyDiff}
          onToggle={() => {
            setOnlyDiff((v) => !v);
          }}
        >
          {t("compare.onlyDiff")}
        </Chip>
      </div>

      <div className="overflow-x-auto" style={{ scrollSnapType: "x mandatory" }}>
        <table className="border-collapse">
          <thead>
            <tr>
              {/* The corner cell carries the sticky ground of the label column, no label of its own. */}
              <th scope="col" style={LABEL_COLUMN} className={`${STICKY_LABEL} bg-bg`} />
              {products.map((p) => (
                <th key={p.id} scope="col" style={COLUMN} className="p-3 text-start align-top">
                  <div className="grid gap-2">
                    <div className="flex items-start gap-2">
                      <Link href={productUrl(p.slug)} className="grid grow gap-2">
                        <span className="plate block">
                          {p.image === undefined ? null : <Img image={p.image} slot="cover" alt="" />}
                        </span>
                        <span className="t-sm line-clamp-2 font-semibold"><Bdi text={p.displayName} /></span>
                      </Link>
                      <button
                        type="button"
                        aria-label={t("compare.remove")}
                        className="shrink-0 p-1 text-ink-3"
                        onClick={() => {
                          remove(p.id);
                        }}
                      >
                        <Icon name="close" size={20} />
                      </button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              // Zebra rows are painted per cell, not on the <tr>: a sticky cell needs its own opaque
              // ground or the scrolled values show through it.
              const zebra = i % 2 === 1;
              return (
                <tr key={row.key}>
                  <th scope="row" style={LABEL_COLUMN} className={`${STICKY_LABEL} ${zebra ? "bg-soft" : "bg-bg"}`}>
                    {row.label}
                  </th>
                  {row.cells.map((cell) => (
                    <td
                      key={cell.id}
                      style={COLUMN}
                      className={`t-sm p-3 align-top${zebra ? " bg-soft" : ""}`}
                    >
                      {cell.node}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
