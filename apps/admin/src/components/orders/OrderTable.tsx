"use client";
import { ORDER_SOURCES, ORDER_STATUSES, faInt, formatJalali } from "@namilux/core/client";
import type { OrderRow } from "@namilux/core/client";
import { MessageSquareText } from "lucide-react";
import { toman } from "@/lib/money";
import { DataTable } from "@/components/data/DataTable";
import { Filters } from "@/components/data/Filters";
import { SavedViews } from "@/components/data/SavedViews";
import { statusTone } from "./status-tone";
import { MethodChip } from "./MethodChip";
import { Avatar, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

/**
 * The orders list. The storefront is picked by the switch above it (SiteSwitch), so the table shows
 * a «سایت» column only while both sites are listed together (`showChannel`).
 */
export function OrderTable({ rows, total, page, pageSize, view }: { rows: OrderRow[]; total: number; page: number; pageSize: number; view: string }) {
  return (
    <div>
      <Filters
        defs={[
          { key: "q", label: fa["orders.searchHint"], kind: "text" },
          { key: "status", label: fa["orders.filters.status"], kind: "multi", options: ORDER_STATUSES.map((s) => ({ value: s, label: fa[`orders.status.${s}`] })) },
          { key: "source", label: fa["orders.filters.source"], kind: "multi", options: ORDER_SOURCES.map((s) => ({ value: s, label: fa[`orders.source.${s}`] })) },
          { key: "from", label: fa["orders.filters.from"], kind: "date" },
          { key: "to", label: fa["orders.filters.to"], kind: "date" },
        ]}
      />
      <div className="mb-4">
        <SavedViews
          presets={[
            { key: "process", label: fa["orders.views.process"], query: "status=paid" },
            { key: "pending", label: fa["orders.views.pending"], query: "status=pending_payment" },
            { key: "shipped", label: fa["orders.views.shipped"], query: "status=shipped" },
            { key: "snapppay", label: fa["pay.method.snapppay"], query: "method=snapppay" },
          ]}
          current={view}
        />
      </div>
      <DataTable
        columns={[
          { key: "code", label: fa["orders.code"], primary: true, className: "cell-code", render: (r) => r.code },
          {
            key: "customer",
            label: fa["orders.customer"],
            render: (r) => (
              <span className="cell-person">
                <Avatar name={r.customerName ?? ""} size="sm" />
                <span className="cell-person__text">
                  <b>{r.customerName ?? fa["orders.customer.unknown"]}</b>
                  <small>{r.phoneMasked}</small>
                </span>
              </span>
            ),
          },
          { key: "total", label: fa["orders.total"], className: "cell-num", render: (r) => toman(r.grandTotal) },
          {
            key: "status",
            label: fa["common.status"],
            render: (r) => (
              <span className="inline-flex items-center gap-2">
                <StatusBadge tone={statusTone(r.status)}>{fa[`orders.status.${r.status}`]}</StatusBadge>
                {r.hasNote ? (
                  <span title={fa["orders.adminNote"]} className="text-ink-3">
                    <MessageSquareText size={15} aria-label={fa["orders.adminNote"]} />
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: "payment",
            label: fa["orders.payment"],
            // How it was paid first (SnappPay in its own colour), then whether the money arrived.
            render: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1">
                <MethodChip method={r.method} />
                {r.paymentStatus === "succeeded" ? <StatusBadge tone="ok">{fa["payment.status.succeeded"]}</StatusBadge> : null}
              </span>
            ),
          },
          {
            key: "shipment",
            label: fa["orders.shipment"],
            render: (r) =>
              r.shipmentStatus === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <StatusBadge tone={r.shipmentStatus === "delivered" ? "ok" : r.shipmentStatus === "returned" ? "warn" : "default"}>{fa[`shipment.status.${r.shipmentStatus}`]}</StatusBadge>
              ),
          },
          { key: "items", label: fa["orders.items"], className: "cell-muted", hideOnPhone: true, render: (r) => faInt(r.itemsCount) },
          { key: "source", label: fa["orders.source"], className: "cell-muted", hideOnPhone: true, render: (r) => fa[`orders.source.${r.source}`] },
          { key: "placedAt", label: fa["orders.placedAt"], className: "cell-muted", render: (r) => formatJalali(r.placedAt, "short") },
        ]}
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        rowHref={(r) => `/orders/${r.code}`}
      />
    </div>
  );
}
