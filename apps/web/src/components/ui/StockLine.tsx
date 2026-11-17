import { t } from "@/i18n";

export function StockLine({
  available,
  lowStock,
  backorder = false,
  onRequest = false,
}: {
  available: number;
  lowStock: boolean;
  backorder?: boolean;
  onRequest?: boolean;
}): React.ReactNode {
  // A price-on-request product has no stock claim to make - the buy box says «استعلام قیمت» instead
  // and a green «موجود» beside it would read as a promise about a price we have not quoted.
  if (onRequest && available <= 0) return null;

  // v2 §9.3: scarcity is only ever shown when it is true. `lowStock` is computed server-side from
  // the real threshold, so this component never invents urgency from a number it was handed.
  if (available <= 0) {
    return backorder ? (
      <p className="stock stock--low">{t("product.stock.backorder")}</p>
    ) : (
      <p className="stock stock--out">{t("product.stock.out")}</p>
    );
  }
  if (lowStock) return <p className="stock stock--low">{t("product.stock.low", { n: available })}</p>;
  return <p className="stock stock--ok">{t("product.stock.in")}</p>;
}
