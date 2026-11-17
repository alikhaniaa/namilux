"use client";
import { formatDeliveryRange, formatToman } from "@namilux/core/client";
import type { ShippingOption } from "@namilux/core/client";
import { t } from "@/i18n";

export function ShippingOptions({ options, value, onChange }: { options: ShippingOption[]; value: string | null; onChange: (key: string) => void }): React.ReactNode {
  if (options.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="t-body text-ink mb-2">{t("checkout.shipping.title")}</legend>
      {options.map((o) => {
        const days = o.etaMin === o.etaMax ? t("product.delivery.etaSame", { min: o.etaMin }) : t("product.delivery.eta", { min: o.etaMin, max: o.etaMax });
        const range = formatDeliveryRange(o.etaMin, o.etaMax);
        return (
          <label key={o.key} className={`opt-card items-center justify-between${value === o.key ? " is-selected" : ""}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name="shipping" checked={value === o.key} onChange={() => onChange(o.key)} />
              <span className="t-body text-ink">{o.name}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="t-caption text-ink-2" title={range === "" ? undefined : days}>
                {range === "" ? days : t("product.delivery.by", { range })}
              </span>
              <span className="tnum text-ink">{o.cost === 0 ? t("cart.summary.free") : `${formatToman(o.cost)} ${t("product.price.unit")}`}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
