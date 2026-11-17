import { faInt } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function SearchTerms({ terms }: { terms: { term: string; count: number }[] }) {
  return (
    <Card title={fa["analytics.searchZero"]}>
      <ul className="space-y-1 text-sm">
        {terms.slice(0, 20).map((t) => (
          <li key={t.term} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-1 last:border-0">
            <span className="truncate">{t.term}</span>
            <span className="shrink-0 tabular-nums">{faInt(t.count)}</span>
          </li>
        ))}
        {terms.length === 0 ? <li className="text-xs text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
      </ul>
    </Card>
  );
}
