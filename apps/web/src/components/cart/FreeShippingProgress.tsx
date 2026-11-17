import { formatToman } from "@namilux/core/client";
import { t } from "@/i18n";
import { Progress } from "@/components/ui/Progress";

export function FreeShippingProgress({ subtotal, freeAbove }: { subtotal: number; freeAbove: number | null }): React.ReactNode {
  if (freeAbove === null || freeAbove <= 0) return null;
  const done = subtotal >= freeAbove;
  const value = Math.min(subtotal / freeAbove, 1);
  return (
    <div className="flex flex-col gap-1">
      <Progress value={value} label={done ? t("cart.freeShipping.done") : t("cart.freeShipping.progress", { amount: formatToman(freeAbove - subtotal) })} />
    </div>
  );
}
