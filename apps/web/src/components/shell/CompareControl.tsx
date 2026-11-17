"use client";
import { faInt } from "@namilux/core/client";
import Link from "next/link";
import { useCompare } from "@/components/state/compare-store";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

// v2 §7: the compare list lives in the header with its count - never a floating tray that covers
// the grid it is describing. The control is always labelled; the two-rectangle glyph alone is not
// a known idiom.
export function CompareControl({ variant }: { variant: "header" | "drawer" }): React.ReactNode {
  const { count } = useCompare();
  if (variant === "drawer" && count === 0) return null;

  return (
    <Link href="/compare/" className={variant === "header" ? "labelled-ctl t-sm" : "flex items-center gap-2 t-sm"}>
      <Icon name="compare" size={20} />
      {t("shell.compare")}
      {count === 0 ? null : <span className="count-pill">{faInt(count)}</span>}
    </Link>
  );
}
