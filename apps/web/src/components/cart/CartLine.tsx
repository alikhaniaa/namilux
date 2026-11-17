"use client";
import { formatToman, mediaUrl } from "@namilux/core/client";
import type { QuoteLine } from "@namilux/core/client";
import { t, tn } from "@/i18n";
import { Bdi } from "@/components/ui/Bdi";
import { Price } from "@/components/ui/Price";
import { Stepper } from "@/components/ui/Stepper";

export function CartLine({ line, onQty, onRemove, onSaveForLater }: { line: QuoteLine; onQty: (qty: number) => void; onRemove: () => void; onSaveForLater: () => void }): React.ReactNode {
  return (
    <div className="cart-line" data-testid="cart-line">
      <div className="plate cart-line__plate">
        {line.image === null ? null : <img src={mediaUrl(line.image)} alt={line.name} width={96} height={120} loading="lazy" decoding="async" />}
      </div>
      <div className="cart-line__head">
        <Bdi text={line.name} className="cart-line__name" />
        <span className="cart-line__unit">
          <Price amount={line.unitPrice} compareAt={line.compareAt ?? null} size="sm" />
        </span>
        {line.status === "qty_reduced" ? <p className="cart-line__meta text-warn">{tn(line.available, "cart.qtyReduced")}</p> : null}
      </div>
      <div className="cart-line__row">
        <Stepper value={line.qty} max={line.available} onChange={onQty} />
        <span className="cart-line__total tnum">
          {formatToman(line.lineTotal)}
          <small>{t("product.price.unit")}</small>
        </span>
      </div>
      <div className="cart-line__actions">
        <button type="button" className="link-under t-caption text-ink-2" onClick={onRemove}>{t("cart.line.remove")}</button>
        <button type="button" className="link-under t-caption text-ink-2" onClick={onSaveForLater}>{t("cart.line.saveForLater")}</button>
      </div>
    </div>
  );
}
