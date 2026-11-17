"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { formatToman, isPriceJump, typedPrice } from "@namilux/core/client";
import { PriceInput } from "@/components/pricing/PriceInput";
import { fa } from "@/i18n/fa";
import { ApiError } from "@/lib/api-client";
import { conflictIds, patchPrices } from "@/lib/price-save";
import { digitsToToman, jumpLabel } from "@/lib/pricing";

/**
 * The list's one-click price edit: click the price, type, Enter. It saves through the pricing
 * section's own write (PATCH /api/products/prices), which carries the price the edit was typed over - 
 * so a row that was repriced elsewhere in the meantime is refused and re-read instead of overwritten
 * (the stale-page write behind "I change the price and it goes back", 24 Sep 2026), and a new price at
 * or above the old «قبل از تخفیف» one ends the discount instead of failing validation.
 *
 * After a save the page is refreshed from the server; ProductTable keys the cell by the stored values,
 * so a refreshed row starts from what the server holds.
 */
export function PriceCell({ id, price, compareAt }: { id: number; price: number; compareAt: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(price === 0 ? "" : String(price));
  const [asked, setAsked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setEditing(false);
    setText(price === 0 ? "" : String(price));
    setAsked(null);
    setError(null);
  }

  async function save(): Promise<void> {
    const next = digitsToToman(text);
    if (next === null || next === price) return close();
    // A zero, or a price a dropped or doubled zero would explain, is written on the second Enter only.
    if ((next === 0 || isPriceJump(price, next)) && asked !== next) {
      setAsked(next);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const after = typedPrice({ price, compareAt }, next).after;
      await patchPrices([{ id, before: { price, compareAtPrice: compareAt }, after: { price: after.price, compareAtPrice: after.compareAt } }]);
      setEditing(false);
      setAsked(null);
      router.refresh();
    } catch (e) {
      if (conflictIds(e) !== null) {
        setError("این قیمت همین حالا از جای دیگری تغییر کرده بود؛ فهرست تازه شد.");
        router.refresh();
      } else {
        setError(e instanceof ApiError ? e.brief : fa["common.error"]);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button type="button" className="text-start hover:text-[var(--accent)]" onClick={() => setEditing(true)} title={fa["common.edit"]}>
        {price === 0 ? fa["products.price.onRequest"] : formatToman(price)}
      </button>
    );
  }
  return (
    <span className="price-cell" onClick={(e) => e.stopPropagation()}>
      <span className="price-cell__row">
        <PriceInput
          autoFocus
          aria-label={fa["products.price"]}
          className="price-cell__input"
          disabled={busy}
          value={text}
          onDigits={(d) => {
            setText(d);
            setAsked(null);
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <button type="button" className="ui-btn ui-btn--default ui-btn--icon-sm" onClick={() => void save()} disabled={busy} aria-label={fa["common.save"]} title={fa["common.save"]}>
          <Check size={15} aria-hidden="true" />
        </button>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon-sm" onClick={close} disabled={busy} aria-label={fa["common.cancel"]} title={fa["common.cancel"]}>
          <X size={15} aria-hidden="true" />
        </button>
      </span>
      {asked !== null ? (
        <span className="price-cell__note price-cell__note--warn" role="alert">
          {asked === 0 ? "قیمت صفر یعنی «استعلام قیمت». برای ثبت دوباره Enter بزنید." : `${jumpLabel(price, asked)}؛ اگر درست است دوباره Enter بزنید.`}
        </span>
      ) : null}
      {error !== null ? <span className="price-cell__note price-cell__note--danger" role="alert">{error}</span> : null}
    </span>
  );
}
