"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { PRICE_SHEET_MAX, enDigits, faDigits, faInt, formatToman, planPrice } from "@namilux/core/client";
import type { BulkPriceOperation, SkipReason } from "@namilux/core/client";
import { Button, Checkbox, EmptyState, Field, Input, Select, StatusBadge } from "@/components/kit";
import { Dialog, toast } from "@/components/kit-client";
import { ApiError } from "@/lib/api-client";
import { conflictIds, putPrices } from "@/lib/price-save";
import type { PriceEdit } from "@/lib/price-save";
import { PRICE_NOTES, digitsToToman, matchesTokens, pricesOf, queryTokens, searchHaystack } from "@/lib/pricing";
import type { PriceRow } from "@/lib/pricing";
import { TOMAN } from "@/lib/money";
import { PriceInput } from "./PriceInput";
import { Delta, ProductCell, Segmented, Step } from "./parts";

type Option = { id: number; name: string };
type Mode = "percent" | "fixed" | "round";
type Direction = "up" | "down";
type Rounding = "" | "10000" | "100000";

const PREVIEW = 100;
const SKIP_FA: Record<SkipReason, string> = {
  on_request: "بدون قیمت (استعلامی)",
  negative: "قیمت منفی می‌شود",
  compare_below_price: "قیمت قبل از تخفیف کمتر از قیمت فروش می‌شود",
  fx_basis: "قیمت ارزی",
  unchanged: "بدون تغییر",
};

/** «۲٫۵», «2.5», «۲/۵» → 2.5; null for an empty box, NaN for anything that is not a per cent. */
function parsePercent(raw: string): number | null {
  const text = enDigits(raw).replace(/[٫/،,]/g, ".").replace(/[٪%\s]/g, "");
  if (text === "") return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Number(text);
}

/** The change the form describes, as the steps the core applies and the sentence the screen shows. */
function buildChange(mode: Mode, direction: Direction, percent: string, amount: string, rounding: Rounding, withCompare: boolean): { steps: BulkPriceOperation[] | null; text: string; problem: string } {
  const sign = direction === "up" ? 1 : -1;
  const way = direction === "up" ? "افزایش" : "کاهش";
  const target: BulkPriceOperation["target"] = withCompare ? "both" : "price";
  const round: BulkPriceOperation | null = rounding === "" ? null : { op: "round", value: 0, target, round: Number(rounding) as 10_000 | 100_000 };
  const rounded = round === null ? "" : `، گرد به ${formatToman(Number(rounding))}`;
  if (mode === "round") {
    return round === null ? { steps: null, text: "", problem: "" } : { steps: [round], text: `گرد کردن به ${formatToman(Number(rounding))} ${TOMAN}`, problem: "" };
  }
  if (mode === "percent") {
    const value = parsePercent(percent);
    if (value === null) return { steps: null, text: "", problem: "" };
    if (Number.isNaN(value) || value <= 0) return { steps: null, text: "", problem: "درصد را به عدد وارد کنید؛ مثلاً ۵ یا ۲٫۵" };
    if (direction === "down" && value > 90) return { steps: null, text: "", problem: "کاهش بیش از ۹۰٪ ممکن نیست." };
    if (value > 500) return { steps: null, text: "", problem: "افزایش بیش از ۵۰۰٪ ممکن نیست." };
    return {
      steps: [{ op: "percent", value: sign * value, target, round: null }, ...(round === null ? [] : [round])],
      text: `${faDigits(String(value)).replace(".", "٫")}٪ ${way}${rounded}`,
      problem: "",
    };
  }
  const value = digitsToToman(amount);
  if (value === null || value <= 0) return { steps: null, text: "", problem: "" };
  return {
    steps: [{ op: "fixed", value: sign * value, target, round: null }, ...(round === null ? [] : [round])],
    text: `${formatToman(value)} ${TOMAN} ${way}${rounded}`,
    problem: "",
  };
}

/** One product of the list: what the change would do to it, or why it cannot be changed. */
type Line =
  | { row: PriceRow; state: "idle" }
  | { row: PriceRow; state: "ok"; after: { price: number; compareAtPrice: number | null }; saleEnded: boolean }
  | { row: PriceRow; state: "skip"; reason: SkipReason };

/**
 * One change for many products: say what happens to the price, pick the products, read every new
 * price, then apply. The products are listed the moment they are searched for - each with a tick - 
 * so what is about to be changed is on the screen before any change is typed. The new prices are
 * computed here with the core's own arithmetic and sent as explicit before → after pairs, so what
 * is on the screen is exactly what gets written - and a row someone else repriced in the meantime
 * is refused instead of overwritten.
 */
export function GroupChange({ rows, brands, categories, selection, selectionNote }: {
  rows: PriceRow[];
  brands: Option[];
  categories: (Option & { ids: number[] })[];
  /** Products picked on the product list (ticked rows, or a filter's whole result); null for none. */
  selection: number[] | null;
  selectionNote: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(selection);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [mode, setMode] = useState<Mode>("percent");
  const [direction, setDirection] = useState<Direction>("up");
  const [percent, setPercent] = useState("");
  const [amount, setAmount] = useState("");
  const [rounding, setRounding] = useState<Rounding>("");
  const [withCompare, setWithCompare] = useState(true);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ edits: PriceEdit[]; text: string } | null>(null);

  const hay = useMemo(() => new Map(rows.map((r) => [r.id, searchHaystack(r)])), [rows]);

  const scope = useMemo(() => {
    const ids = picked === null ? null : new Set(picked);
    const cats = categories.find((c) => String(c.id) === category)?.ids;
    const tokens = queryTokens(q);
    return rows.filter((r) =>
      (ids === null || ids.has(r.id)) &&
      (brand === "" || String(r.brandId) === brand) &&
      (cats === undefined || r.categoryIds.some((id) => cats.includes(id))) &&
      (!availableOnly || r.available) &&
      (tokens.length === 0 || matchesTokens(hay.get(r.id) ?? "", tokens)));
  }, [rows, picked, brand, category, availableOnly, q, categories, hay]);

  const { steps, text, problem } = useMemo(() => buildChange(mode, direction, percent, amount, rounding, withCompare), [mode, direction, percent, amount, rounding, withCompare]);

  const lines = useMemo<Line[]>(() => scope.map((row): Line => {
    // Neither can take a percentage or an amount, whatever the change is: say so from the start.
    if (row.priceBasis !== "manual") return { row, state: "skip", reason: "fx_basis" };
    if (row.price === 0) return { row, state: "skip", reason: "on_request" };
    if (steps === null) return { row, state: "idle" };
    const r = planPrice({ price: row.price, compareAt: row.compareAtPrice }, steps);
    return "skip" in r ? { row, state: "skip", reason: r.skip } : { row, state: "ok", after: { price: r.after.price, compareAtPrice: r.after.compareAt }, saleEnded: r.saleEnded };
  }), [scope, steps]);

  /** Rows that can be ticked: everything the change applies to (or, before one is typed, could). */
  const tickable = lines.filter((l) => l.state !== "skip");
  const ticked = tickable.filter((l) => !excluded.has(l.row.id));
  const chosen = lines.flatMap((l) => (l.state === "ok" && !excluded.has(l.row.id) ? [l] : []));
  const narrowed = picked !== null || brand !== "" || category !== "" || availableOnly || q.trim() !== "";
  const tooMany = chosen.length > PRICE_SHEET_MAX;
  const shown = showAll ? lines : lines.slice(0, PREVIEW);

  async function save(edits: PriceEdit[], note: string, undoing: boolean): Promise<void> {
    setBusy(true);
    try {
      const result = await putPrices(edits, note);
      toast(undoing ? `قیمت ${faInt(result.updated)} کالا به حالت قبل برگشت.` : `قیمت ${faInt(result.updated)} کالا تغییر کرد.`);
      setApplied(undoing ? null : { edits, text });
      setPercent("");
      setAmount("");
      setExcluded(new Set());
      router.refresh();
    } catch (e) {
      if (conflictIds(e) !== null) {
        toast("قیمت بعضی از این کالاها در همین فاصله تغییر کرده است و چیزی ثبت نشد. فهرست تازه شد؛ دوباره بررسی و اعمال کنید.", "error");
        router.refresh();
      } else {
        toast(e instanceof ApiError ? e.message : "ذخیره انجام نشد. اتصال را بررسی کنید.", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const toggle = (ids: number[], on: boolean): void =>
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  return (
    <div className="price-flow">
      {applied !== null ? (
        <div className="ui-note ui-note--ok" role="status">
          <span className="grow">قیمت {faInt(applied.edits.length)} کالا تغییر کرد ({applied.text}).</span>
          <Button
            size="sm"
            variant="outline"
            busy={busy}
            icon={<RotateCcw size={14} aria-hidden="true" />}
            onClick={() => void save(applied.edits.map((e) => ({ id: e.id, before: e.after, after: e.before })), PRICE_NOTES.undo, true)}
          >
            برگرداندن این تغییر
          </Button>
        </div>
      ) : null}

      <Step n="۱" title="چه تغییری؟">
        <div className="price-flow__ops">
          <Segmented<Mode>
            label="نوع تغییر"
            value={mode}
            onChange={setMode}
            options={[{ value: "percent", label: "درصدی" }, { value: "fixed", label: "مبلغ ثابت" }, { value: "round", label: "فقط گرد کردن" }]}
          />
          {mode === "round" ? null : (
            <Segmented<Direction> label="جهت" value={direction} onChange={setDirection} options={[{ value: "up", label: "افزایش" }, { value: "down", label: "کاهش" }]} />
          )}
        </div>
        <div className="price-flow__grid">
          {mode === "percent" ? (
            <Field label="چند درصد؟" {...(problem === "" ? {} : { error: problem })}>
              <span className="ui-money">
                <Input dir="ltr" inputMode="decimal" autoComplete="off" placeholder="۵" value={percent} onChange={(e) => setPercent(e.target.value)} />
                <span className="ui-money__unit">٪</span>
              </span>
            </Field>
          ) : mode === "fixed" ? (
            <Field label="چه مبلغی؟">
              <span className="ui-money">
                <PriceInput aria-label="مبلغ" placeholder="۵۰۰٬۰۰۰" value={amount} onDigits={setAmount} />
                <span className="ui-money__unit">{TOMAN}</span>
              </span>
            </Field>
          ) : null}
          <Field label={mode === "round" ? "گرد کردن به" : "گرد کردن قیمت جدید"}>
            <Select value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)}>
              <option value="">{mode === "round" ? "انتخاب کنید" : "بدون گرد کردن"}</option>
              <option value="10000">نزدیک‌ترین {formatToman(10_000)} {TOMAN}</option>
              <option value="100000">نزدیک‌ترین {formatToman(100_000)} {TOMAN}</option>
            </Select>
          </Field>
        </div>
        <Checkbox label="قیمت قبل از تخفیف هم به همین اندازه تغییر کند" checked={withCompare} onChange={(e) => setWithCompare(e.target.checked)} />
      </Step>

      <Step n="۲" title="روی کدام کالاها؟" hint="جستجو کنید یا برند و دسته را انتخاب کنید؛ کالاها همین پایین فهرست می‌شوند. تیک هر کالایی را که نمی‌خواهید بردارید.">
        {picked !== null ? (
          <p className="ui-note">
            <span className="grow">{selectionNote ?? `${faInt(picked.length)} کالای انتخاب‌شده از فهرست محصولات`}</span>
            <button type="button" className="ui-link-btn" onClick={() => setPicked(null)}>همهٔ کالاها</button>
          </p>
        ) : null}
        <div className="price-flow__grid">
          <label className="data-filters__search">
            <Search size={16} aria-hidden="true" />
            <input type="search" className="ui-input" aria-label="جستجوی نام یا کد کالا" placeholder="نام، مدل یا کد کالا…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Select aria-label="برند" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">همهٔ برندها</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select aria-label="دسته" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">همهٔ دسته‌ها</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Checkbox label="فقط کالاهای موجود" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />
        </div>
        <p className={narrowed ? "price-flow__count" : "price-flow__count price-flow__count--warn"}>
          {narrowed ? <><b>{faInt(scope.length)}</b> کالا</> : <>فیلتری انتخاب نشده است: <b>همهٔ {faInt(scope.length)} کالا</b></>}
          {tickable.length > 0 ? <> · <b>{faInt(ticked.length)}</b> کالا تیک خورده</> : null}
        </p>
        {lines.length === 0 ? (
          <EmptyState text="کالایی با این مشخصات پیدا نشد." />
        ) : (
          <>
            <div className="admin-table-scroll">
              <table className="admin-data-table is-cards price-preview">
                <thead>
                  <tr>
                    <th className="cell-check">
                      <input
                        type="checkbox"
                        aria-label="انتخاب همه"
                        disabled={tickable.length === 0}
                        checked={tickable.length > 0 && ticked.length === tickable.length}
                        onChange={(e) => toggle(tickable.map((l) => l.row.id), e.target.checked)}
                      />
                    </th>
                    <th>کالا</th>
                    <th>قیمت فعلی</th>
                    <th>قیمت جدید</th>
                    <th>تغییر</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((line) => {
                    const { row } = line;
                    const on = line.state !== "skip" && !excluded.has(row.id);
                    return (
                      <tr key={row.id} data-product-id={row.id} data-line={line.state} data-off={!on || undefined}>
                        <td className="cell-check">
                          <input type="checkbox" aria-label={`اعمال روی ${row.displayName}`} disabled={line.state === "skip"} checked={on} onChange={(e) => toggle([row.id], e.target.checked)} />
                        </td>
                        <td className="cell-primary"><ProductCell row={row} link={false} /></td>
                        <td data-label="قیمت فعلی"><bdi className="money">{row.price === 0 ? "استعلامی" : formatToman(row.price)}</bdi></td>
                        <td data-label="قیمت جدید" className="cell-num">
                          {line.state === "ok" ? (
                            <>
                              <bdi className="money">{formatToman(line.after.price)}</bdi>
                              {line.after.compareAtPrice !== null ? <small className="price-preview__sub">قبل از تخفیف: <bdi>{formatToman(line.after.compareAtPrice)}</bdi></small> : null}
                              {line.saleEnded ? <small className="price-preview__sub">تخفیف برداشته می‌شود</small> : null}
                            </>
                          ) : line.state === "skip" ? (
                            <StatusBadge tone="muted" dot={false}>{SKIP_FA[line.reason]}</StatusBadge>
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>
                        <td data-label="تغییر">{line.state === "ok" ? <Delta before={row.price} after={line.after.price} /> : <span className="cell-muted">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {lines.length > shown.length ? (
              <p className="price-more">
                <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>نمایش همهٔ {faInt(lines.length)} کالا</Button>
                <span>{faInt(shown.length)} کالای اول نمایش داده شده؛ تغییر روی همهٔ کالاهای تیک‌خورده اعمال می‌شود.</span>
              </p>
            ) : null}
          </>
        )}
      </Step>

      {/* Always within reach, however long the list: what is about to happen, and the one button that does it. */}
      <div className="price-applybar">
        <p className="price-applybar__text">
          {steps === null ? (
            "تغییر را در مرحلهٔ ۱ وارد کنید تا قیمت جدید هر کالا را ببینید."
          ) : tooMany ? (
            `در هر نوبت حداکثر ${faInt(PRICE_SHEET_MAX)} قیمت ثبت می‌شود؛ کالاها را محدودتر کنید.`
          ) : chosen.length === 0 ? (
            "با این تغییر، قیمت هیچ‌کدام از کالاهای تیک‌خورده عوض نمی‌شود."
          ) : (
            <><b>{text}</b> روی <b>{faInt(chosen.length)}</b> کالا. تا «اعمال» را نزنید چیزی تغییر نمی‌کند.</>
          )}
        </p>
        <Button disabled={chosen.length === 0 || tooMany} busy={busy} onClick={() => setConfirming(true)}>
          اعمال روی {faInt(chosen.length)} کالا
        </Button>
      </div>

      <p className="price-flow__foot">
        برای تغییر قیمت تک‌تک کالاها با عدد دلخواه، از <Link href="/products/prices" className="ui-link-btn">تغییر سریع</Link> استفاده کنید.
      </p>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`قیمت ${faInt(chosen.length)} کالا تغییر کند؟`}
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)}>انصراف</Button>
            <Button
              onClick={() => {
                // The question is answered: it steps aside, so the second-factor prompt that may follow is the only dialog on screen.
                setConfirming(false);
                void save(chosen.map((c) => ({ id: c.row.id, before: pricesOf(c.row), after: c.after })), `${PRICE_NOTES.group} · ${text}`, false);
              }}
            >
              بله، اعمال شود
            </Button>
          </>
        }
      >
        <p className="text-sm"><b>{text}</b> روی {faInt(chosen.length)} کالا.</p>
        <p className="text-sm text-[var(--ink-2)]">قیمت‌ها بلافاصله روی سایت تغییر می‌کنند. بعد از اعمال، دکمهٔ «برگرداندن این تغییر» همین بالا در دسترس است.</p>
      </Dialog>
    </div>
  );
}
