import Link from "next/link";
import { faInt } from "@namilux/core/client";
import { fa } from "@/i18n/fa";
import { methodLabel as label } from "./MethodChip";

export { MethodChip } from "./MethodChip";

/** The methods the switch offers, in the order staff think of them. */
export const METHOD_FILTERS = ["zarinpal", "snapppay", "none"] as const;
export type MethodFilter = (typeof METHOD_FILTERS)[number];

/**
 * «همه · کارت بانکی · اسنپ‌پی · بدون پرداخت آنلاین» above the orders table, with counts under the
 * list's other filters, plus a warning chip when SnappPay orders need a person. The choice lives in
 * the URL (`?method=`, `?attention=1`) so a filtered link can be shared or bookmarked.
 */
export function PaymentMethodSwitch({
  params,
  current,
  counts,
  attention,
  attentionOn,
}: {
  params: Record<string, string>;
  current: MethodFilter | undefined;
  counts: Record<string, number>;
  attention: number;
  attentionOn: boolean;
}) {
  const href = (set: Record<string, string | undefined>): string => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    for (const [k, v] of Object.entries(set)) {
      if (v === undefined) sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    return qs === "" ? "/orders" : `/orders?${qs}`;
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <nav className="ui-segmented min-w-0" aria-label={fa["pay.method.label"]}>
        <Link href={href({ method: undefined })} className="ui-segmented__item" aria-current={current === undefined ? "page" : undefined}>
          {fa["pay.method.all"]}
          <span className="ui-segmented__count">{faInt(total)}</span>
        </Link>
        {METHOD_FILTERS.map((m) => (
          <Link key={m} href={href({ method: m })} className="ui-segmented__item" data-method={m} aria-current={current === m ? "page" : undefined}>
            {label(m)}
            <span className="ui-segmented__count">{faInt(counts[m] ?? 0)}</span>
          </Link>
        ))}
      </nav>
      {attention > 0 || attentionOn ? (
        <Link href={href({ attention: attentionOn ? undefined : "1" })} className="attention-chip" aria-current={attentionOn ? "page" : undefined}>
          {fa["pay.attention"]}
          <span className="ui-segmented__count">{faInt(attention)}</span>
        </Link>
      ) : null}
    </div>
  );
}
