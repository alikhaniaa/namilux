import type { Badge as BadgeKind } from "@namilux/core/client";
import { t } from "@/i18n";

const CLASS = { sale: "badge--sale", new: "badge--new", last: "badge--last", out: "badge--out" } as const;

// `kind` is the core discriminated union, so the percent travels with the sale badge itself and a
// caller cannot pair the wrong number with the wrong badge.
export function Badge({ kind }: { kind: BadgeKind; percent?: number }): React.ReactNode {
  const label =
    kind.kind === "sale"
      ? t("product.badge.sale", { n: kind.percent })
      : kind.kind === "new"
        ? t("product.badge.new")
        : kind.kind === "last"
          ? t("product.badge.last")
          : t("product.badge.out");
  return <span className={`badge ${CLASS[kind.kind]}`}>{label}</span>;
}
