"use client";
import { faInt } from "@namilux/core/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Pagination } from "./Pagination";
import { EmptyRow } from "@/components/kit";
import { fa } from "@/i18n/fa";

/**
 * One column. `primary` marks the cell that titles a row when the table folds into cards on a phone
 * (it loses its «label:» prefix and leads the card); `className` styles the cell (cell-num,
 * cell-muted, cell-actions…).
 */
export type Column<T> = { key: string; label: string; sortable?: boolean; render?: (row: T) => ReactNode; width?: string; ltr?: boolean; primary?: boolean; className?: string; hideOnPhone?: boolean };

function cellText(v: unknown): ReactNode {
  if (typeof v === "number") return faInt(v);
  if (typeof v === "string") return v;
  return fa["common.none"];
}

export function DataTable<T extends { id: string | number }>({
  columns,
  rows,
  total,
  page,
  pageSize,
  sort,
  onSort,
  selectable = false,
  bulkBar,
  rowHref,
  selectedIds,
  onSelectionChange,
}: {
  columns: Column<T>[];
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  sort?: string;
  onSort?: (s: string) => void;
  selectable?: boolean;
  bulkBar?: ReactNode;
  rowHref?: (row: T) => string;
  selectedIds?: (string | number)[];
  onSelectionChange?: (ids: (string | number)[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [internal, setInternal] = useState<(string | number)[]>([]);
  const selected = selectedIds ?? internal;
  const setSelected = (ids: (string | number)[]): void => {
    setInternal(ids);
    onSelectionChange?.(ids);
  };

  const currentSort = sort ?? params.get("sort") ?? "";
  const sortDir = (key: string): "ascending" | "descending" | "none" =>
    currentSort === `${key}_asc` ? "ascending" : currentSort === `${key}_desc` ? "descending" : "none";
  const changeSort = (key: string): void => {
    const next = currentSort === `${key}_asc` ? `${key}_desc` : `${key}_asc`;
    if (onSort !== undefined) {
      onSort(next);
      return;
    }
    const sp = new URLSearchParams(params.toString());
    sp.set("sort", next);
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`);
  };

  const pageIds = rows.map((r) => r.id);
  const allSelected = rows.length > 0 && pageIds.every((id) => selected.includes(id));
  const someSelected = !allSelected && pageIds.some((id) => selected.includes(id));
  const headCheck = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headCheck.current !== null) headCheck.current.indeterminate = someSelected;
  }, [someSelected]);
  const toggleAll = (): void => {
    setSelected(allSelected ? selected.filter((id) => !pageIds.includes(id)) : [...new Set([...selected, ...pageIds])]);
  };
  const toggle = (id: string | number): void => {
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const open = (row: T): void => {
    if (rowHref !== undefined) router.push(rowHref(row));
  };

  const colSpan = columns.length + (selectable ? 1 : 0);

  return (
    <div className="data-list">
      {selected.length > 0 ? (
        <div className="data-selection" role="region" aria-live="polite">
          <span className="data-selection__count">{fa["table.selected"].replace("{n}", faInt(selected.length))}</span>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setSelected([])}>
            {fa["table.clearSelection"]}
          </button>
          <div className="data-selection__actions">{bulkBar}</div>
        </div>
      ) : null}
      <div className="admin-table-scroll" role="region" aria-label={fa["table.scrollHint"]} tabIndex={0}>
        <table className="admin-data-table is-cards" style={{ minInlineSize: `${String(Math.max(640, columns.length * 104))}px` }}>
          <thead>
            <tr>
              {selectable ? (
                <th className="cell-check">
                  <input ref={headCheck} type="checkbox" aria-label={fa["common.all"]} checked={allSelected} onChange={toggleAll} />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} style={c.width === undefined ? undefined : { inlineSize: c.width }} aria-sort={c.sortable === true ? sortDir(c.key) : undefined}>
                  {c.sortable === true ? (
                    <button type="button" onClick={() => changeSort(c.key)}>
                      {c.label}
                      <span className="sort" aria-hidden="true">
                        {sortDir(c.key) === "ascending" ? <ArrowUp size={13} /> : sortDir(c.key) === "descending" ? <ArrowDown size={13} /> : <ChevronsUpDown size={13} />}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isSelected = selected.includes(row.id);
              return (
                <tr
                  key={String(row.id)}
                  data-selected={isSelected || undefined}
                  data-href={rowHref === undefined ? undefined : ""}
                  tabIndex={rowHref === undefined ? undefined : 0}
                  onClick={(e) => {
                    if (rowHref === undefined) return;
                    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label") !== null) return;
                    open(row);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "j" || e.key === "k" || e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const next = e.key === "j" || e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
                      if (next instanceof HTMLElement) next.focus();
                    } else if (e.key === "e" || e.key === "Enter") {
                      open(row);
                    } else if (e.key === " " && selectable) {
                      e.preventDefault();
                      toggle(row.id);
                    }
                  }}
                >
                  {selectable ? (
                    <td className="cell-check">
                      <input type="checkbox" aria-label={String(row.id)} checked={isSelected} onChange={() => toggle(row.id)} />
                    </td>
                  ) : null}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      data-label={c.primary === true ? undefined : c.label}
                      className={[c.ltr === true ? "ltr" : "", c.primary === true ? "cell-primary" : "", c.hideOnPhone === true ? "cell-phone-hide" : "", c.className ?? ""].filter((x) => x !== "").join(" ") || undefined}
                    >
                      {c.render !== undefined ? c.render(row) : cellText((row as Record<string, unknown>)[c.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 ? <EmptyRow colSpan={colSpan} text={fa["table.empty"]} /> : null}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
