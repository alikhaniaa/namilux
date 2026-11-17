import { formatToman } from "@namilux/core/client";
import type { Quote } from "@namilux/core/client";
import type { FaKey } from "@/i18n";
import { t } from "@/i18n";
import { Button } from "@/components/ui/Button";

type CtaProps = { label: FaKey; href?: string; onClick?: () => void; loading?: boolean };

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }): React.ReactNode {
  return (
    <div className={`flex items-baseline justify-between ${strong ? "t-body text-ink font-700" : "t-body text-ink-2"}`}>
      <span>{label}</span>
      <span className="tnum text-ink">{value}</span>
    </div>
  );
}

export function OrderSummary({ quote, cta, compact }: { quote: Quote | null; cta?: CtaProps; compact?: boolean }): React.ReactNode {
  const q = quote;
  const amount = (n: number): string => `${formatToman(n)} ${t("product.price.unit")}`;
  return (
    <div className={`panel ps-4 pe-4 pt-4 pb-4 ${compact === true ? "" : "sticky top-[128px]"}`}>
      <div className="flex flex-col gap-2">
        <Row label={t("cart.summary.subtotal")} value={q !== null ? amount(q.subtotal) : "…"} />
        {q !== null && q.discount > 0 ? <Row label={t("cart.summary.discount")} value={`− ${amount(q.discount)}`} /> : null}
        {q !== null && q.pointsDiscount > 0 ? <Row label={t("cart.summary.points")} value={`− ${amount(q.pointsDiscount)}`} /> : null}
        <Row label={t("cart.summary.shipping")} value={q !== null ? (q.shipping === 0 ? t("cart.summary.free") : amount(q.shipping)) : "…"} />
        <div className="hr" />
        <Row label={t("cart.summary.total")} value={q !== null ? amount(q.grandTotal) : "…"} strong />
      </div>
      {cta !== undefined ? (
        <div className="mt-4">
          <Button variant="primary" block arrow loading={cta.loading ?? false} {...(cta.href !== undefined ? { href: cta.href } : {})} {...(cta.onClick !== undefined ? { onClick: cta.onClick } : {})}>
            {t(cta.label)}
          </Button>
        </div>
      ) : null}
      <p className="t-caption text-ink-2 mt-3">{t("cart.trust")}</p>
    </div>
  );
}
