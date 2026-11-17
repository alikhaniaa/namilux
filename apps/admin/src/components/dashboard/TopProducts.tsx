import Link from "next/link";
import { faInt, formatToman } from "@namilux/core";
import { Card, EmptyState } from "@/components/kit";
import { fa } from "@/i18n/fa";

/** The best sellers of the last 30 days by units, each with a bar against the leader. */
export function TopProducts({ items }: { items: { productId: number; displayName: string; qty: number; revenue: number }[] }) {
  const lead = Math.max(1, ...items.map((p) => p.qty));
  return (
    <Card title={fa["dash.top"]} description={fa["dash.top.hint"]}>
      {items.length === 0 ? (
        <EmptyState text={fa["dash.top.empty"]} />
      ) : (
        <ol className="rank-list">
          {items.slice(0, 6).map((p, i) => (
            <li key={p.productId}>
              <span className="rank-list__n">{faInt(i + 1)}</span>
              <span className="rank-list__main">
                <Link href={`/products/${String(p.productId)}`} className="rank-list__name">
                  {p.displayName}
                </Link>
                <span className="rank-list__bar" aria-hidden="true">
                  <span style={{ inlineSize: `${String(Math.round((p.qty / lead) * 100))}%` }} />
                </span>
              </span>
              <span className="rank-list__val">
                <b>{fa["dash.top.units"].replace("{n}", faInt(p.qty))}</b>
                <small>
                  {formatToman(p.revenue)} {fa["form.toman"]}
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
