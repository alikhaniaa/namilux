"use client";
import { cheapestOption, etaDays, formatDeliveryRange, formatToman, isProvinceCode, loadProvinces, shippingOptions } from "@namilux/core/client";
import type { Province, ProvinceCode, ShippingMethod } from "@namilux/core/client";
import { useEffect, useState } from "react";
import { useCity } from "@/components/state/city-store";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/i18n";

/** No saved city yet → the estimate is shown for Tehran, greyed, until the shopper says otherwise. */
const DEFAULT_PROVINCE: ProvinceCode = "THR";

export function DeliveryEstimator({ methods }: { methods: ShippingMethod[] }): React.ReactNode {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const [provinces, setProvinces] = useState<readonly Province[] | null>(null);
  const [province, setProvince] = useState<ProvinceCode>(DEFAULT_PROVINCE);
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => {
    setToday(new Date());
  }, []);

  // A stored province that is not one of the 31 codes (an older shape, a hand-edited value) is
  // treated as "no city yet" rather than trusted into a lookup.
  const saved = city !== null && isProvinceCode(city.province) ? city.province : null;
  const code = saved ?? DEFAULT_PROVINCE;

  // The 2,705-city dataset is fetched only when the sheet is actually opened (the spec budgets).
  useEffect(() => {
    if (!open) return undefined;
    setProvince(saved ?? DEFAULT_PROVINCE);
    let alive = true;
    void loadProvinces().then(
      (all) => {
        if (alive) setProvinces(all);
      },
      () => {
        // Offline: the sheet keeps its prompt instead of throwing inside a render path.
      },
    );
    return () => {
      alive = false;
    };
  }, [open, saved]);

  // DECISION: `shippingOptions` is asked only when the page actually handed us methods. The buy box
  // mounts this island without any (its own contract carries none), and the fallback is not an
  // invention: the spec defines the free_nationwide bands as exactly `etaDays(code)`, free.
  const option = methods.length === 0 ? null : cheapestOption(shippingOptions(methods, code, 0));
  const eta = option === null ? etaDays(code) : { min: option.etaMin, max: option.etaMax };
  const cost = option?.cost ?? 0;

  // Design audit 2 Sep 2026 (Baymard: a delivery DATE, not a speed): the Jalali window is the line,
  // the working-day count stays as the tooltip. An ICU build without the Persian calendar returns
  // "" and the day count is shown instead.
  const daysText = eta.min === eta.max ? t("product.delivery.etaSame", { min: eta.min }) : t("product.delivery.eta", { min: eta.min, max: eta.max });
  // The PDP is a cached render (cacheComponents): a date baked into the HTML would go stale, so
  // the server paints the day count and the window is computed on the visitor's own clock after
  // hydration - the same text swap the city line already does.
  const range = today === null ? "" : formatDeliveryRange(eta.min, eta.max, today);
  const parts: { text: string; title?: string }[] = [
    ...(city === null ? [] : [{ text: t("product.delivery.to", { city: city.city }) }]),
    range === "" ? { text: daysText } : { text: t("product.delivery.by", { range }), title: daysText },
    // v2 §10.2: this line is the PDP's one and only home for «ارسال رایگان».
    { text: cost === 0 ? t("product.delivery.free") : t("product.delivery.cost", { amount: formatToman(cost) }) },
  ];

  const provinceOptions = (provinces ?? []).map((p) => ({ value: p.code, label: p.name }));
  const cityOptions = (provinces?.find((p) => p.code === province)?.cities ?? []).map((name) => ({ value: name, label: name }));

  return (
    <div className="t-sm grid gap-1">
      <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${saved === null ? "text-ink-3" : "text-ink-2"}`}>
        <Icon name="truck" size={20} />
        {parts.map((part, i) => (
          <span key={part.text} title={part.title}>
            {i > 0 ? <span aria-hidden="true">· </span> : null}
            {part.text}
          </span>
        ))}
      </p>
      <p>
        <button
          type="button"
          className="link-under text-ink"
          onClick={() => {
            setOpen(true);
          }}
        >
          {city === null ? t("product.delivery.choose") : t("product.delivery.change")}
        </button>
      </p>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={t("product.delivery.change")}
      >
        <div className="grid gap-4">
          <Select
            name="province"
            label="checkout.address.province"
            value={province}
            options={provinceOptions}
            disabled={provinces === null}
            onChange={(value) => {
              if (isProvinceCode(value)) setProvince(value);
            }}
          />
          <Select
            name="city"
            label="checkout.address.city"
            value={city?.city ?? ""}
            options={cityOptions}
            disabled={provinces === null}
            placeholder="product.delivery.choose"
            searchable
            onChange={(value) => {
              // Picking the city is the whole decision - there is nothing left to confirm.
              setCity({ v: 1, province, city: value });
              setOpen(false);
            }}
          />
          {provinces === null ? <p className="t-sm text-ink-3">{t("a11y.loading")}</p> : null}
        </div>
      </Sheet>
    </div>
  );
}
