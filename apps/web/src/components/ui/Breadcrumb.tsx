import type { Crumb } from "@namilux/core/client";
import Link from "next/link";
import { t } from "@/i18n";

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }): React.ReactNode {
  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;
  return (
    <nav aria-label={t("a11y.breadcrumb")} className="t-xs text-ink-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {crumbs.map((c, i) => (
          <li key={c.href} className="flex items-center gap-2">
            {i === last ? (
              // The current page is not a link; it keeps its name so the trail still reads as a path.
              <span aria-current="page" className="text-ink-2">
                {c.name}
              </span>
            ) : (
              <Link href={c.href} className="link-under">
                {c.name}
              </Link>
            )}
            {/* Separator is decorative: the list structure already carries the order. */}
            {i === last ? null : <span aria-hidden="true">›</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
