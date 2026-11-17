import { faInt, plpUrl } from "@namilux/core/client";
import type { PlpState } from "@namilux/core/client";
import Link from "next/link";
import { ButtonCoin, ButtonLabel } from "@/components/ui/Button";
import { t } from "@/i18n";

/** A short window around the current page - a 200-page catalogue must not render 200 links. */
function windowAround(page: number, last: number): number[] {
  const from = Math.max(1, Math.min(page - 2, last - 4));
  const to = Math.min(last, Math.max(page + 2, 5));
  const out: number[] = [];
  for (let p = from; p <= to; p += 1) out.push(p);
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  state,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  state: PlpState;
}): React.ReactNode {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (last <= 1) return null;
  const shown = Math.min(page * pageSize, total);
  const pct = total === 0 ? 100 : Math.round((shown / total) * 100);

  // DECISION (kept from the header): «نمایش بیشتر» is a plain link to ?page=N+1, not a fetch of an
  // HTML fragment. Every page stays its own cacheable, shareable, crawlable URL - which is also
  // what makes the `?page=N` self-canonical of the spec true rather than aspirational.
  return (
    <nav aria-label={t("plp.page", { n: page })} className="plp-pagination">
      <p className="plp-pagination__count">
        <span>{t("plp.showing", { shown, total })}</span>
        <span className="plp-pagination__bar" aria-hidden="true">
          <span style={{ inlineSize: `${String(pct)}%` }} />
        </span>
      </p>
      {page < last ? (
        <Link href={plpUrl(basePath, { ...state, page: page + 1 })} className="btn btn--secondary btn--lg">
          <ButtonLabel>{t("plp.loadMore")}</ButtonLabel>
          <ButtonCoin icon="arrow-s" />
        </Link>
      ) : null}

      <ol className="flex flex-wrap items-center justify-center gap-2">
        {windowAround(page, last).map((p) => (
          <li key={p}>
            <Link
              href={plpUrl(basePath, { ...state, page: p })}
              aria-current={p === page ? "page" : undefined}
              className={`chip plp-pagination__num${p === page ? "" : " text-ink-2"}`}
            >
              {faInt(p)}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
