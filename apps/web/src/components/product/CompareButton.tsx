"use client";
import { useCompare } from "@/components/state/compare-store";
import { toast } from "@/components/state/toast-store";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

export function CompareButton({ productId }: { productId: number }): React.ReactNode {
  const compare = useCompare();
  const on = compare.has(productId);
  return (
    <Button
      variant="quiet"
      icon="compare"
      aria-pressed={on}
      onClick={() => {
        const changed = compare.toggle(productId);
        if (!changed && !on) toast.show({ key: "product.compare.full", vars: { n: compare.max } });
      }}
    >
      {on ? t("product.compare.remove") : t("product.compare.add")}
    </Button>
  );
}
