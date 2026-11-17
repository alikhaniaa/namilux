"use client";
import { CUSTOMER_TIERS, faInt, formatJalali } from "@namilux/core/client";
import { toman } from "@/lib/money";
import type { CustomerRow } from "@namilux/core/client";
import { DataTable } from "@/components/data/DataTable";
import { ExportButton } from "@/components/data/ExportButton";
import { Filters } from "@/components/data/Filters";
import { StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function CustomerTable({ rows, total, page, pageSize, canExport, exportQuery }: { rows: CustomerRow[]; total: number; page: number; pageSize: number; canExport: boolean; exportQuery: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Filters
          defs={[
            { key: "q", label: fa["common.search"], kind: "text" },
            { key: "tier", label: fa["customers.tier"], kind: "multi", options: CUSTOMER_TIERS.map((t) => ({ value: t, label: fa[`customers.tier.${t}`] })) },
            { key: "blocked", label: fa["customers.blocked"], kind: "bool" },
            { key: "optIn", label: fa["customers.optIn"], kind: "bool" },
          ]}
        />
        <ExportButton href={`/api/customers/export${exportQuery === "" ? "" : `?${exportQuery}`}`} permission="customers.export" allowed={canExport} />
      </div>
      <DataTable
        columns={[
          { key: "name", label: fa["customers.name"], render: (r) => r.name ?? fa["common.none"] },
          { key: "phone", label: fa["customers.phone"], ltr: true, render: (r) => r.phoneMasked },
          { key: "tier", label: fa["customers.tier"], render: (r) => fa[`customers.tier.${r.tier}`] },
          { key: "orders", label: fa["customers.orders"], render: (r) => faInt(r.ordersCount) },
          { key: "spend", label: fa["customers.spend"], render: (r) => <span className="whitespace-nowrap tabular-nums">{toman(r.lifetimeSpend)}</span> },
          { key: "last", label: fa["customers.lastOrder"], render: (r) => (r.lastOrderAt === null ? fa["common.none"] : formatJalali(r.lastOrderAt, "short")) },
          // 3 Sep 2026 walkthrough: the column was blank for every ordinary customer - state it.
          {
            key: "flags",
            label: fa["common.status"],
            render: (r) => (
              <span className="flex flex-wrap items-center gap-1">
                {r.isBlocked ? <StatusBadge tone="warn">{fa["customers.blocked"]}</StatusBadge> : <StatusBadge tone="ok">{fa["common.active"]}</StatusBadge>}
                {r.marketingOptIn ? <span className="text-xs text-[var(--ink-2)]">{fa["customers.optIn"]}</span> : null}
              </span>
            ),
          },
        ]}
        rows={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        rowHref={(r) => `/customers/${r.id}`}
      />
    </div>
  );
}
