import { formatToman } from "@namilux/core/client";
import { t } from "@/i18n";

const SIZE = { sm: "price--sm", md: "", lg: "price--lg" } as const;

export function Price({
  amount,
  compareAt,
  size = "md",
  showSave = false,
}: {
  amount: number;
  compareAt?: number | null;
  size?: "sm" | "md" | "lg";
  showSave?: boolean;
}): React.ReactNode {
  // the spec: price is INK, never the accent - weight carries the salience, not colour.
  // Proportional figures by default; `.tnum` is only for columns that must align.
  const discounted = typeof compareAt === "number" && compareAt > amount;
  const priceClass = ["price", SIZE[size]].filter((c) => c !== "").join(" ");
  return (
    <span className="prices">
      <span className={priceClass}>
        {formatToman(amount)}
        <span className="price-unit">{t("product.price.unit")}</span>
      </span>
      {discounted ? (
        <span>
          <span className="price-was">{formatToman(compareAt)}</span>
          {showSave ? (
            <span className="price-save"> {t("product.price.save", { amount: formatToman(compareAt - amount) })}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
