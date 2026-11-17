"use client";
import type { QuoteLine, QuoteWarning } from "@namilux/core/client";
import { t } from "@/i18n";
import { Bdi } from "@/components/ui/Bdi";

export function UnavailableLines({
  lines,
  warnings = [],
  onWishlist,
  onRemove,
}: {
  lines: QuoteLine[];
  /** The quote's warnings: a line removed because instalments are switched off for it says so. */
  warnings?: QuoteWarning[];
  onWishlist: (id: number) => void;
  onRemove: (id: number) => void;
}): React.ReactNode {
  if (lines.length === 0) return null;
  const instalmentOff = new Set(warnings.flatMap((w) => (w.kind === "removed" && w.reason === "instalment_ineligible" ? [w.productId] : [])));
  return (
    <section className="panel ps-4 pe-4 pt-4 pb-4">
      <h2 className="d-3 text-ink mb-3">{t("cart.unavailable")}</h2>
      <ul className="flex flex-col gap-3">
        {lines.map((l) => (
          <li key={l.productId} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <Bdi text={l.name} className="t-body text-ink-2" />
              {instalmentOff.has(l.productId) ? <span className="t-caption text-ink-3">{t("cart.instalmentOff")}</span> : null}
            </span>
            <div className="flex gap-3">
              <button type="button" className="link-under t-caption" onClick={() => onWishlist(l.productId)}>{t("cart.line.saveForLater")}</button>
              <button type="button" className="link-under t-caption" onClick={() => onRemove(l.productId)}>{t("cart.line.remove")}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
