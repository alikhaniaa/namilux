import type { ProductCard } from "@namilux/core/client";
import Link from "next/link";
import { RelatedRail } from "@/components/product/RelatedRail";
import { t } from "@/i18n";

export function CompareEmpty({ rail }: { rail: ProductCard[] }): React.ReactNode {
  // the spec: an empty state always ends in a product rail - a dead end is a lost session.
  return (
    <div className="grid gap-6">
      <div className="wrap chapter grid justify-items-center gap-4 text-center">
        <h1 className="d-2">{t("compare.empty.title")}</h1>
        <p className="t-lead max-w-[46ch] text-ink-2">{t("compare.empty.body")}</p>
        <Link href="/shop/" className="btn btn--primary">
          {t("nav.shop")}
        </Link>
      </div>
      <RelatedRail title="compare.empty.rail" items={rail} />
    </div>
  );
}
