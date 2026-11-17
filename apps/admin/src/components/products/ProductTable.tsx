"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt, formatToman } from "@namilux/core/client";
import type { AdminProductFilter } from "@namilux/core";
import { PriceCell } from "./PriceCell";
import { BulkBar } from "@/components/data/BulkBar";
import { DataTable } from "@/components/data/DataTable";
import { Filters } from "@/components/data/Filters";
import { SavedViews } from "@/components/data/SavedViews";
import { MediaThumb } from "@/components/media/MediaThumb";
import { Pencil } from "lucide-react";
import { StatusBadge } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";
import { filterQueryString, hasFilterCriteria } from "@/lib/product-filters";

export type ProductListRow = {
  id: number;
  slug: string;
  displayName: string;
  brandName: string | null;
  modelCode: string | null;
  price: number;
  compareAtPrice: number | null;
  isOnRequest: boolean;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  stockPolicy: "track" | "untracked";
  stockQty: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  imageKey: string | null;
  updatedAt: string;
  /** The instalment storefront's price (the list carries it; shown to a staff member confined to that site). */
  instalmentPrice?: number | null;
};

export function ProductTable({
  rows,
  total,
  page,
  pageSize,
  brands,
  filter,
  canPrice,
  canBulk,
  canWrite,
  view,
  instalmentView = false,
}: {
  rows: ProductListRow[];
  total: number;
  page: number;
  pageSize: number;
  brands: { id: number; name: string }[];
  filter: AdminProductFilter;
  canPrice: boolean;
  canBulk: boolean;
  canWrite: boolean;
  view: string;
  /** Confined to the instalment site: its price, not the main site's, and no inline price editing. */
  instalmentView?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<(string | number)[]>([]);
  const ids = selected.map(Number);
  const filtered = hasFilterCriteria(filter);

  /**
   * The pricing section's group change is handed the list's own filter string, so «همهٔ نتایج» is this
   * exact result set on every page - and a selection is handed its ids, which outrank the filter.
   */
  const bulkHref = (selection?: number[]): string => {
    const qs = filterQueryString(filter, selection === undefined || selection.length === 0 ? {} : { ids: selection.join(",") });
    return qs === "" ? "/products/prices/group" : `/products/prices/group?${qs}`;
  };

  const noRows = rows.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Filters
          defs={[
            { key: "q", label: fa["common.search"], kind: "text" },
            { key: "brandId", label: fa["products.filters.brand"], kind: "select", options: brands.map((b) => ({ value: String(b.id), label: b.name })) },
            { key: "status", label: fa["products.filters.status"], kind: "select", options: (["draft", "active", "archived"] as const).map((s) => ({ value: s, label: fa[`products.status.${s}`] })) },
            { key: "stockState", label: fa["products.filters.stock"], kind: "select", options: (["in", "out", "low", "backorder"] as const).map((s) => ({ value: s, label: fa[`products.stock.${s}`] })) },
            { key: "priceState", label: fa["products.filters.price"], kind: "select", options: [{ value: "priced", label: fa["products.price.priced"] }, { value: "on_request", label: fa["products.price.onRequest"] }, { value: "sale", label: fa["products.price.sale"] }] },
            { key: "missing", label: fa["products.filters.missing"], kind: "select", options: (["image", "description", "spec", "seo"] as const).map((s) => ({ value: s, label: fa[`products.missing.${s}`] })) },
          ]}
        />
        <div className="mb-4">
        <SavedViews
          presets={[
            { key: "noPrice", label: fa["products.views.noPrice"], query: "priceState=on_request" },
            { key: "lowStock", label: fa["products.views.lowStock"], query: "stockState=low" },
            { key: "noImage", label: fa["products.views.noImage"], query: "missing=image" },
            { key: "noDesc", label: fa["products.views.noDesc"], query: "missing=description" },
          ]}
          current={view}
        />
        </div>
      </div>
      {canBulk && filtered && total > 0 ? (
        <p className="ui-note mt-2">
          <Link href={bulkHref()} className="ui-btn ui-btn--outline ui-btn--sm">
            {fa["products.bulk.fromFilter"].replace("{n}", faInt(total))}
          </Link>
          <span>{fa["products.bulk.filter.summary"]}</span>
        </p>
      ) : null}
      {noRows && filtered ? (
        <div className="ui-note mt-2" role="status">
          <span>{filter.q === undefined ? fa["products.search.noneFiltered"] : fa["products.search.none"].replace("{q}", filter.q)}</span>
          <Link href="/products" className="ui-btn ui-btn--outline ui-btn--sm">
            {fa["products.search.clear"]}
          </Link>
        </div>
      ) : (
        <DataTable
          selectable={canWrite || canBulk}
          selectedIds={selected}
          onSelectionChange={setSelected}
          rowHref={(r) => `/products/${String(r.id)}`}
          bulkBar={
            <BulkBar
              selectedIds={ids}
              onDone={() => {
                setSelected([]);
                router.refresh();
              }}
              actions={[
                ...(canBulk ? [{ key: "price", label: fa["products.bulkPrice"], onRun: async (sel: number[]) => { router.push(bulkHref(sel)); await Promise.resolve(); } }] : []),
                ...(canWrite
                  ? [
                      {
                        key: "archive",
                        label: fa["common.archive"],
                        confirm: (n: number) => `${fa["common.archive"]} · ${faInt(n)}`,
                        onRun: async (sel: number[]) => {
                          for (const id of sel) await api(`/api/products/${String(id)}/archive`, { method: "POST", body: { redirectTo: null } });
                          toast(fa["common.saved"]);
                        },
                      },
                    ]
                  : []),
              ]}
            />
          }
          columns={[
            {
              key: "name",
              label: fa["products.displayName"],
              primary: true,
              render: (r) => (
                <span className="cell-product">
                  {r.imageKey === null ? (
                    <span className="cell-thumb" aria-hidden="true" />
                  ) : (
                    <span className="cell-thumb overflow-hidden">
                      <MediaThumb media={{ storageKey: r.imageKey, image: null }} />
                    </span>
                  )}
                  <span className="cell-product__text">
                    <Link href={`/products/${String(r.id)}`} className="cell-name hover:text-[var(--accent)]">
                      {r.displayName}
                    </Link>
                    <small>
                      {r.brandName ?? fa["products.noBrand"]}
                      {r.modelCode !== null && !r.displayName.includes(r.modelCode) ? <span className="ltr"> · {r.modelCode}</span> : null}
                    </small>
                  </span>
                </span>
              ),
            },
            instalmentView
              ? {
                  key: "price",
                  label: `${fa["products.instalmentPrice"]} (${fa["form.toman"]})`,
                  sortable: true,
                  className: "cell-num",
                  render: (r) => <span className="money">{r.isOnRequest || r.instalmentPrice === null || r.instalmentPrice === undefined ? fa["products.price.onRequest"] : formatToman(r.instalmentPrice)}</span>,
                }
              : {
                  key: "price",
                  label: `${fa["products.price"]} (${fa["form.toman"]})`,
                  sortable: true,
                  className: "cell-num",
                  render: (r) => (
                    <span className="money ltr inline-block">
                      {canPrice ? <PriceCell key={`${String(r.id)}:${String(r.price)}:${String(r.compareAtPrice)}`} id={r.id} price={r.price} compareAt={r.compareAtPrice} /> : r.isOnRequest ? fa["products.price.onRequest"] : formatToman(r.price)}
                    </span>
                  ),
                },
            {
              key: "stock",
              label: fa["products.available"],
              sortable: true,
              render: (r) =>
                r.stockPolicy === "untracked" ? (
                  <span className="stock-pill stock-pill--free">{fa["products.stock.untracked"]}</span>
                ) : r.available <= 0 ? (
                  <span className="stock-pill stock-pill--out">{fa["dash.stock.out"]}</span>
                ) : (
                  <span className={r.available <= r.lowStockThreshold ? "stock-pill" : "stock-pill stock-pill--ok"}>{faInt(r.available)}</span>
                ),
            },
            {
              key: "status",
              label: fa["common.status"],
              render: (r) => (
                <span className="flex flex-wrap gap-1">
                  <StatusBadge tone={r.status === "active" ? "ok" : r.status === "archived" ? "muted" : "default"}>{fa[`products.status.${r.status}`]}</StatusBadge>
                  {r.visibility !== "public" ? <StatusBadge tone="muted">{fa[`products.visibility.${r.visibility}`]}</StatusBadge> : null}
                </span>
              ),
            },
            {
              key: "actions",
              label: "",
              width: "3.5rem",
              className: "cell-actions",
              hideOnPhone: true,
              render: (r) => (
                <Link href={`/products/${String(r.id)}`} className="ui-btn ui-btn--ghost ui-btn--icon-sm" aria-label={`${instalmentView ? fa["common.view"] : fa["common.edit"]} ${r.displayName}`} title={instalmentView ? fa["common.view"] : fa["common.edit"]}>
                  <Pencil size={15} aria-hidden="true" />
                </Link>
              ),
            },
          ]}
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
        />
      )}
    </div>
  );
}
