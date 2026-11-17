import type { Review, ReviewSummary } from "@namilux/core/client";
import { faInt } from "@namilux/core/client";
import { LazyForm } from "./LazyForm";
import { ReviewList } from "./ReviewList";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

const STARS = [5, 4, 3, 2, 1] as const;

export function Reviews({
  productId,
  summary,
  initial,
  total,
}: {
  productId: number;
  summary: ReviewSummary;
  initial: Review[];
  total?: number;
}): React.ReactNode {
  const count = total ?? summary.count;
  return (
    <section className="grid gap-6" aria-labelledby="reviews-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h2 id="reviews-title" className="d-3">
            {t("product.reviews")}
          </h2>
          <p className="t-sm text-ink-2">
            {summary.count === 0 ? t("product.reviews.empty") : `${t("product.reviews.avg", { n: summary.avg })} · ${t("product.reviews.count", { n: summary.count })}`}
          </p>
        </div>
        {summary.count > 0 ? (
          <ul className="grid w-full max-w-xs gap-1" aria-label={t("product.reviews")}>
            {STARS.map((s) => {
              const n = summary.histogram[s];
              const pct = summary.count === 0 ? 0 : Math.round((n / summary.count) * 100);
              return (
                <li key={s} className="flex items-center gap-2 t-xs text-ink-3">
                  <span className="flex w-8 items-center gap-0.5">
                    {faInt(s)}
                    <Icon name="star" size={16} />
                  </span>
                  <span className="h-[6px] flex-1 bg-bg-soft" aria-hidden="true">
                    <span className="block h-full bg-ink" style={{ inlineSize: `${String(pct)}%` }} />
                  </span>
                  <span className="w-6 text-end tnum">{faInt(n)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </header>

      {count > 0 ? <ReviewList productId={productId} initial={initial} total={count} /> : null}

      <div className="hairline-t pt-6">
        {/* The form (and the validation runtime it carries) arrives on first intent, not with the page. */}
        <LazyForm kind="review" productId={productId} />
      </div>
    </section>
  );
}
