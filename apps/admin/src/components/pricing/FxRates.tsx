"use client";
import { currencyLabel } from "@/i18n/admin-labels";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BASE_CURRENCIES, enDigits, faDigits, faInt, formatToman } from "@namilux/core/client";
import { Button, EmptyState, Field, Input, Select } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { ApiError, api } from "@/lib/api-client";
import { TOMAN } from "@/lib/money";
import { Delta, Step } from "./parts";

type FxRow = { id: number; displayName: string; basePrice: number; before: number; after: number };
type Currency = (typeof BASE_CURRENCIES)[number];

/**
 * Products priced in a foreign currency take their Toman price from one rate. Typing today's rate
 * shows every price it would produce; nothing moves until «اعمال» is pressed.
 */
export function FxRates() {
  const router = useRouter();
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [rate, setRate] = useState("");
  const [rounding, setRounding] = useState<"0" | "10000" | "100000">("10000");
  const [rows, setRows] = useState<FxRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const value = Number(enDigits(rate).replace(/[,٬،\s]/g, ""));
  const valid = rate.trim() !== "" && Number.isFinite(value) && value > 0;
  const changed = rows === null ? 0 : rows.filter((r) => r.after !== r.before).length;

  async function run(dryRun: boolean): Promise<void> {
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api<{ rows: FxRow[]; changed: number }>("/api/products/fx", { method: "POST", body: { baseCurrency: currency, rate: value, rounding: Number(rounding), dryRun } });
      if (dryRun) setRows(res.rows);
      else {
        toast(`قیمت ${faInt(res.changed)} کالا با نرخ تازه به‌روز شد.`);
        setRows(null);
        router.refresh();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "انجام نشد. اتصال را بررسی کنید.", "error");
    } finally {
      setBusy(false);
    }
  }
  /** A preview answers for one rate; changing any input makes it a preview of something else. */
  function edit<T>(set: (v: T) => void): (v: T) => void {
    return (v) => {
      set(v);
      setRows(null);
    };
  }

  return (
    <div className="price-flow">
      <Step n="۱" title="نرخ امروز" hint="قیمت تومانی کالاهای ارزی = قیمت ارزی × نرخ. کالاهایی که قیمت دستی دارند تغییر نمی‌کنند.">
        <div className="price-flow__grid">
          <Field label="ارز">
            <Select value={currency} onChange={(e) => edit(setCurrency)(e.target.value as Currency)}>
              {BASE_CURRENCIES.map((c) => <option key={c} value={c}>{currencyLabel(c)}</option>)}
            </Select>
          </Field>
          <Field label="نرخ هر واحد">
            <span className="ui-money">
              <Input dir="ltr" inputMode="decimal" autoComplete="off" value={rate} onChange={(e) => edit(setRate)(e.target.value)} />
              <span className="ui-money__unit">{TOMAN}</span>
            </span>
          </Field>
          <Field label="گرد کردن قیمت">
            <Select value={rounding} onChange={(e) => edit(setRounding)(e.target.value as "0" | "10000" | "100000")}>
              <option value="0">بدون گرد کردن</option>
              <option value="10000">نزدیک‌ترین {formatToman(10_000)} {TOMAN}</option>
              <option value="100000">نزدیک‌ترین {formatToman(100_000)} {TOMAN}</option>
            </Select>
          </Field>
        </div>
        <div>
          <Button variant="outline" disabled={!valid} busy={busy && rows === null} onClick={() => void run(true)}>نمایش قیمت‌های جدید</Button>
        </div>
      </Step>

      <Step
        n="۲"
        title="قیمت‌های جدید"
        hint={rows === null ? "نرخ را وارد کنید و «نمایش قیمت‌های جدید» را بزنید." : "تا «اعمال» را نزنید چیزی تغییر نمی‌کند."}
        actions={<Button disabled={changed === 0} busy={busy && rows !== null} onClick={() => void run(false)}>اعمال روی {faInt(changed)} کالا</Button>}
      >
        {rows === null ? null : rows.length === 0 ? (
          <EmptyState text={`کالایی با قیمت ${currencyLabel(currency)} وجود ندارد.`} hint="مبنای قیمت هر کالا در صفحهٔ همان کالا، بخش «قیمت و موجودی» تعیین می‌شود." />
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-data-table is-cards price-preview">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>قیمت ارزی</th>
                  <th>قیمت فعلی</th>
                  <th>قیمت جدید</th>
                  <th>تغییر</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="cell-primary"><span className="cell-name">{r.displayName}</span></td>
                    <td data-label="قیمت ارزی"><bdi>{faDigits(String(r.basePrice))} {currencyLabel(currency)}</bdi></td>
                    <td data-label="قیمت فعلی"><bdi className="money">{formatToman(r.before)}</bdi></td>
                    <td data-label="قیمت جدید" className="cell-num"><bdi className="money">{formatToman(r.after)}</bdi></td>
                    <td data-label="تغییر"><Delta before={r.before} after={r.after} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Step>
    </div>
  );
}
