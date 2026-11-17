"use client";
import { currencyLabel } from "@/i18n/admin-labels";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProductAdminInput } from "@namilux/core/client";
import { faDigits, BASE_CURRENCIES, enDigits, faInt, formatToman, margin } from "@namilux/core/client";
import type { FormApi } from "@/components/forms/Form";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Checkbox, Field, Input, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function TabPriceStock({ f, canCost, canPrice, stock }: { f: FormApi<ProductAdminInput>; canCost: boolean; canPrice: boolean; stock: { stockQty: number; reservedQty: number; availableQty: number } | null }) {
  const router = useRouter();
  const v = f.values;
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"restock" | "adjust" | "return">("restock");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Only the head admin ever sees these two - the box is absent, and so is the key in the payload.
  const profit = margin({ price: v.price, costPrice: v.costPrice ?? null });
  // Absent means "leave the stored value alone" on the server; the form always carries it, so the
  // checkbox reflects the row (true for a new product, matching the column default).
  const eligible = v.instalmentEligible ?? true;

  async function adjust(): Promise<void> {
    const d = Number(enDigits(delta));
    if (!Number.isInteger(d) || d === 0 || v.id === undefined) return;
    setBusy(true);
    try {
      await api(`/api/products/${String(v.id)}/stock`, { method: "PUT", body: { delta: d, reason, ...(note.trim() === "" ? {} : { note: note.trim() }) } });
      toast(fa["common.saved"]);
      setDelta("");
      setNote("");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <fieldset className="min-w-0 space-y-3" disabled={!canPrice}>
        {!canPrice ? <p className="text-sm text-[var(--ink-2)]">{fa["products.price.readOnly"]}</p> : null}
        <MoneyInput label={fa["products.price"]} value={v.price} onChange={(n) => f.set("price", n ?? 0)} error={f.errors.price ?? ""} hint={fa["products.price.onRequest"]} />
        <MoneyInput label={fa["products.compareAt"]} value={v.compareAtPrice ?? null} onChange={(n) => f.set("compareAtPrice", n)} error={f.errors.compareAtPrice ?? ""} />
        {canCost ? (
          <MoneyInput
            label={fa["products.cost"]}
            value={v.costPrice ?? null}
            onChange={(n) => f.set("costPrice", n)}
            hint={profit === null ? fa["products.margin.none"] : `${fa["products.margin"]}: ${formatToman(profit.toman)} · ٪${faInt(Math.round(profit.ratio * 100))}`}
          />
        ) : null}
        <div className="space-y-1">
          <Checkbox
            label={fa["products.instalmentEligible"]}
            checked={eligible}
            aria-describedby="product-instalment-eligible-help"
            onChange={(e) => f.set("instalmentEligible", e.target.checked)}
          />
          <p id="product-instalment-eligible-help" className="text-xs text-[var(--ink-2)]">
            {eligible ? fa["products.instalmentEligible.on"] : fa["products.instalmentEligible.off"]}
          </p>
        </div>
        <p className="ui-note">قیمت پرداخت با اسنپ‌پی همان قیمت فروش محصول است.</p>
        <Field label={fa["products.priceBasis"]}>
          <Select value={v.priceBasis} onChange={(e) => f.set("priceBasis", e.target.value)}>
            <option value="manual">{fa["products.priceBasis.manual"]}</option>
            <option value="fx">{fa["products.priceBasis.fx"]}</option>
          </Select>
        </Field>
        {v.priceBasis === "fx" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={fa["products.basePrice"]} error={f.errors.basePrice ?? ""}>
              <Input dir="ltr" inputMode="decimal" value={v.basePrice === null || v.basePrice === undefined ? "" : String(v.basePrice)} onChange={(e) => { const n = Number(enDigits(e.target.value)); f.set("basePrice", e.target.value === "" || !Number.isFinite(n) ? null : n); }} />
            </Field>
            <Field label={fa["products.baseCurrency"]}>
              <Select value={v.baseCurrency ?? ""} onChange={(e) => f.set("baseCurrency", e.target.value === "" ? null : e.target.value)}>
                <option value="">انتخاب کنید</option>
                {BASE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {currencyLabel(c)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </fieldset>
      <section className="space-y-3">
        <Field label={fa["products.stockPolicy"]}>
          <Select value={v.stockPolicy} onChange={(e) => f.set("stockPolicy", e.target.value)}>
            <option value="track">{fa["products.stockPolicy.track"]}</option>
            <option value="untracked">{fa["products.stockPolicy.untracked"]}</option>
          </Select>
        </Field>
        {stock !== null ? (
          <dl className="grid grid-cols-3 gap-2 border border-[var(--line)] p-2 text-sm">
            <dt className="text-[var(--ink-2)]">{fa["products.stock"]}</dt>
            <dt className="text-[var(--ink-2)]">{fa["products.reserved"]}</dt>
            <dt className="text-[var(--ink-2)]">{fa["products.available"]}</dt>
            <dd className="tabular-nums">{faInt(stock.stockQty)}</dd>
            <dd className="tabular-nums">{faInt(stock.reservedQty)}</dd>
            <dd className="tabular-nums font-medium">{faInt(stock.availableQty)}</dd>
          </dl>
        ) : null}
        {v.id !== undefined && v.stockPolicy === "track" ? (
          <div className="flex flex-wrap items-end gap-2 border border-[var(--line)] p-2">
            <Field label={fa["products.adjust.delta"]}>
              <Input dir="ltr" inputMode="numeric" className="w-24" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+5 / -2" />
            </Field>
            <Field label={fa["products.adjust.reason"]}>
              <Select className="w-32" value={reason} onChange={(e) => setReason(e.target.value as "restock" | "adjust" | "return")}>
                <option value="restock">{fa["products.adjust.reason.restock"]}</option>
                <option value="adjust">{fa["products.adjust.reason.adjust"]}</option>
                <option value="return">{fa["products.adjust.reason.return"]}</option>
              </Select>
            </Field>
            <Field label={fa["products.adjust.note"]}>
              <Input className="w-48" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            <Button size="sm" variant="outline" disabled={busy || delta.trim() === ""} onClick={() => void adjust()}>
              {fa["products.adjust"]}
            </Button>
          </div>
        ) : null}
        <Checkbox label={fa["products.backorder"]} checked={v.allowBackorder} onChange={(e) => f.set("allowBackorder", e.target.checked)} />
        <div className="grid grid-cols-2 gap-2">
          <Field label={fa["products.lowStock"]}>
            <Input dir="ltr" inputMode="numeric" value={faDigits(v.lowStockThreshold)} onChange={(e) => f.set("lowStockThreshold", Math.max(0, Math.min(1000, Number(enDigits(e.target.value)) || 0)))} />
          </Field>
          <Field label={fa["products.maxPerOrder"]}>
            <Input dir="ltr" inputMode="numeric" value={faDigits(v.maxPerOrder)} onChange={(e) => f.set("maxPerOrder", Math.max(1, Math.min(50, Number(enDigits(e.target.value)) || 1)))} />
          </Field>
        </div>
      </section>
    </div>
  );
}
