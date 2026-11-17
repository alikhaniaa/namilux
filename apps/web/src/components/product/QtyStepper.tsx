"use client";
import { MAX_QTY_PER_LINE } from "@namilux/core/client";
import { toast } from "@/components/state/toast-store";
import { Stepper } from "@/components/ui/Stepper";

/**
 * The buyable ceiling for one line: the product's own cap, what is actually available, and the
 * cart's hard cap - whichever is smallest.
 * DECISION: the floor is 1, not 0. A stepper pinned to 0 is a dead control, and whether the product
 * can be bought at all is the buy box's decision (it renders «اطلاع از موجودی» instead of this row
 * when the product is out of stock), not this wrapper's.
 */
function ceiling(maxPerOrder: number, available: number): number {
  const bounds = [maxPerOrder, available, MAX_QTY_PER_LINE].filter((n) => Number.isFinite(n) && n > 0);
  return bounds.length === 0 ? 1 : Math.max(1, Math.floor(Math.min(...bounds)));
}

export function QtyStepper({
  value,
  onChange,
  maxPerOrder,
  available,
}: {
  value: number;
  onChange: (v: number) => void;
  maxPerOrder: number;
  available: number;
}): React.ReactNode {
  const max = ceiling(maxPerOrder, available);
  // A value that arrives above the ceiling (stock dropped under the shopper, or a qty restored from
  // the cart) is shown clamped rather than echoed back as a number we cannot honour.
  const shown = Math.min(Math.max(1, Math.floor(value)), max);

  return (
    <Stepper
      value={shown}
      max={max}
      onChange={(next) => {
        // ui/Stepper already disables [+] at the bound, so the only way past it is a bound that
        // moved; then the shopper is told why the number stopped instead of it silently sticking.
        if (next > max) {
          toast.show({ key: "product.qty.max", vars: { n: max } });
          onChange(max);
          return;
        }
        onChange(Math.max(1, next));
      }}
    />
  );
}
