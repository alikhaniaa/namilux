import Link from "next/link";
import { SALES_CHANNELS, faInt } from "@namilux/core";
import type { SalesChannel } from "@namilux/core";
import { fa } from "@/i18n/fa";

/**
 * «همه · نامی‌لوکس · اقساطی» above a list that holds both storefronts' records. One list with a
 * switch, not two menus: the orders are one workflow (the same statuses, shipping and refunds), and
 * the owner mostly wants all of them - while a click narrows to one site, with its own count, and
 * the choice lives in the URL (`?channel=`) so a filtered link can be shared or bookmarked.
 *
 * A staff member confined to one site never sees this: their list is that site's and nothing else.
 */
export function SiteSwitch({
  basePath,
  params,
  current,
  counts,
}: {
  basePath: string;
  /** The page's other query parameters, kept as they are when the site changes. */
  params: Record<string, string>;
  current: SalesChannel | undefined;
  counts?: Record<SalesChannel, number> | undefined;
}) {
  const href = (channel: SalesChannel | undefined): string => {
    const sp = new URLSearchParams(params);
    sp.delete("channel");
    sp.delete("page");
    if (channel !== undefined) sp.set("channel", channel);
    const qs = sp.toString();
    return qs === "" ? basePath : `${basePath}?${qs}`;
  };
  const total = counts === undefined ? undefined : counts.main + counts.instalments;
  return (
    <nav className="ui-segmented" aria-label={fa["orders.channel"]}>
      <Link href={href(undefined)} className="ui-segmented__item" aria-current={current === undefined ? "page" : undefined}>
        {fa["channel.all"]}
        {total === undefined ? null : <span className="ui-segmented__count">{faInt(total)}</span>}
      </Link>
      {SALES_CHANNELS.map((c) => (
        <Link key={c} href={href(c)} className="ui-segmented__item" data-site={c} aria-current={current === c ? "page" : undefined}>
          <span className="site-dot" data-site={c} aria-hidden="true" />
          {c === "instalments" ? "بایگانی سایت قبلی" : "نامی‌لوکس"}
          {counts === undefined ? null : <span className="ui-segmented__count">{faInt(counts[c])}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** The chip a confined staff member sees where the switch would be: which site this panel shows. */
export function SiteScopeBadge({ channel }: { channel: SalesChannel }) {
  return (
    <span className="site-chip" data-site={channel}>
      <span className="site-dot" data-site={channel} aria-hidden="true" />
      {fa["scope.only"].replace("{site}", fa[`channel.${channel}`])}
    </span>
  );
}
