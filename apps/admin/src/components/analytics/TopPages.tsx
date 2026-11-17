import { faInt } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function TopPages({ pages, origin }: { pages: { path: string; views: number }[]; origin: string }) {
  return (
    <Card title={fa["analytics.topPages"]}>
      <ol className="space-y-1 text-sm">
        {pages.slice(0, 20).map((p) => (
          <li key={p.path} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-1 last:border-0">
            <a href={`${origin}${p.path}`} target="_blank" rel="noreferrer" className="ltr truncate text-xs hover:text-[var(--accent)]">
              {p.path}
            </a>
            <span className="shrink-0 tabular-nums">{faInt(p.views)}</span>
          </li>
        ))}
        {pages.length === 0 ? <li className="text-xs text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
      </ol>
    </Card>
  );
}
