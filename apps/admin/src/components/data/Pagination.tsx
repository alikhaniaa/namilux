"use client";
import { faInt } from "@namilux/core/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fa } from "@/i18n/fa";

export const PAGE_SIZES = [50, 100, 200] as const;

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

  const go = (patch: { page?: number; pageSize?: number }): void => {
    const next = new URLSearchParams(sp.toString());
    if (patch.pageSize !== undefined) {
      next.set("pageSize", String(patch.pageSize));
      next.set("page", "1");
    }
    if (patch.page !== undefined) next.set("page", String(patch.page));
    router.push(`${pathname}?${next.toString()}`);
  };

  const sizes = [...new Set<number>([...PAGE_SIZES, pageSize])].sort((a, b) => a - b);

  return (
    <footer className="data-pagination">
      <span>{fa["table.total"].replace("{n}", faInt(total))}</span>
      <div className="data-pagination__controls">
        <label>
          <span>{fa["table.perPage"]}</span>
          <select className="ui-select" value={String(pageSize)} onChange={(e) => go({ pageSize: Number(e.target.value) })}>
            {sizes.map((n) => (
              <option key={n} value={n}>
                {faInt(n)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ui-btn ui-btn--outline ui-btn--sm" disabled={page <= 1} onClick={() => go({ page: page - 1 })}>
          {fa["table.prev"]}
        </button>
        <span className="data-pagination__page">{fa["table.page"].replace("{n}", faInt(page)).replace("{m}", faInt(pages))}</span>
        <button type="button" className="ui-btn ui-btn--outline ui-btn--sm" disabled={page >= pages} onClick={() => go({ page: page + 1 })}>
          {fa["table.next"]}
        </button>
      </div>
    </footer>
  );
}
