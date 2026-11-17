"use client";
import { faInt } from "@namilux/core/client";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export function Stepper({
  value,
  min = 1,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (v: number) => void;
}): React.ReactNode {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <div className="stepper" role="group" aria-label={t("product.qty")}>
      {/* Order in the DOM is decrement, value, increment; RTL lays it out visually without any
          physical side being named. */}
      <button type="button" aria-label={t("product.qty.dec")} disabled={atMin} onClick={() => onChange(value - 1)}>
        <Icon name="minus" size={20} />
      </button>
      {/* The value is text, not an input: a free-text qty on a phone opens a keyboard for a number
          that is bounded anyway, and the two buttons are the whole interaction. */}
      <output aria-live="polite">{faInt(value)}</output>
      <button type="button" aria-label={t("product.qty.inc")} disabled={atMax} onClick={() => onChange(value + 1)}>
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
