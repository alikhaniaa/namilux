import Link from "next/link";
import { SALES_CHANNELS, faInt, formatToman } from "@namilux/core";
import type { SalesChannel } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

/**
 * The owner's view of the two storefronts side by side: each site's paid sales in the selected
 * range, its share of the total, and its order count - a link into that site's orders.
 */
export function SiteSplit({ byChannel, rangeLabel }: { byChannel: Record<SalesChannel, { revenue: number; orders: number }>; rangeLabel: string }) {
  const total = byChannel.main.revenue + byChannel.instalments.revenue;
  return (
    <Card title={fa["dash.split.title"]} description={rangeLabel}>
      <ul className="split">
        {SALES_CHANNELS.map((c) => {
          const share = total === 0 ? 0 : byChannel[c].revenue / total;
          return (
            <li key={c}>
              <Link href={`/orders?channel=${c}`} className="split__row">
                <span className="split__head">
                  <span className="site-dot" data-site={c} aria-hidden="true" />
                  <b>{fa[`channel.${c}`]}</b>
                  <span className="split__share">{faInt(Math.round(share * 100))}٪</span>
                </span>
                <span className="split__bar" aria-hidden="true">
                  <span data-site={c} style={{ inlineSize: `${String(Math.round(share * 1000) / 10)}%` }} />
                </span>
                <span className="split__foot">
                  <span>
                    {formatToman(byChannel[c].revenue)} {fa["form.toman"]}
                  </span>
                  <span>{fa["dash.split.orders"].replace("{n}", faInt(byChannel[c].orders))}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
