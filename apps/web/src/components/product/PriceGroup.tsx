import { faInt, formatToman } from "@namilux/core/client";
import { Price } from "@/components/ui/Price";
import { t } from "@/i18n";

export function PriceGroup({
  price,
  compareAt,
  installments,
}: {
  price: number;
  compareAt: number | null;
  installments?: { months: number; monthly: number } | null;
}): React.ReactNode {
  // v2 §9.3: a tile shows the percentage (it reads at a glance in a grid), the PDP shows the
  // absolute saving in Toman (that is the number a 40 M-Toman decision is actually made on).
  return (
    <div className="grid gap-2">
      <Price amount={price} compareAt={compareAt} size="lg" showSave />
      {installments == null ? null : (
        <p className="t-sm text-ink-2">
          {t("product.installments", { months: faInt(installments.months), amount: formatToman(installments.monthly) })}
        </p>
      )}
    </div>
  );
}
