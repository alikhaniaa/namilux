"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ClipboardCopy, RotateCcw } from "lucide-react";
import { PRICE_SHEET_MAX, faInt, formatToman, isPriceJump, typedPrice } from "@namilux/core/client";
import { Button, EmptyState, Select, StatusBadge, Textarea } from "@/components/kit";
import type { Tone } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { ApiError } from "@/lib/api-client";
import { exportPriceList, indexProducts, matchLine, parsePriceList } from "@/lib/price-paste";
import type { PasteUnit } from "@/lib/price-paste";
import { conflictIds, putPrices } from "@/lib/price-save";
import type { PriceEdit } from "@/lib/price-save";
import { PRICE_NOTES, pricesOf, rowCode } from "@/lib/pricing";
import type { PriceRow, Prices } from "@/lib/pricing";
import { Delta, Segmented, Step } from "./parts";

type Reading = "ready" | "jump" | "zero" | "same" | "pick" | "none" | "noprice" | "locked" | "repeat";
type Item = { line: number; raw: string; key: string; price: number | null; row: PriceRow | null; candidates: PriceRow[]; after: Prices | null; reading: Reading };

const READING: Record<Reading, { label: string; tone: Tone }> = {
  ready: { label: "آماده", tone: "ok" },
  jump: { label: "اختلاف زیاد با قیمت فعلی", tone: "warn" },
  zero: { label: "استعلامی می‌شود", tone: "warn" },
  same: { label: "بدون تغییر", tone: "muted" },
  pick: { label: "کدام کالا؟", tone: "warn" },
  none: { label: "کالا پیدا نشد", tone: "danger" },
  noprice: { label: "قیمت ندارد", tone: "muted" },
  locked: { label: "قیمت ارزی", tone: "muted" },
  repeat: { label: "تکراری", tone: "muted" },
};
/** Written without being asked. `jump` and `zero` are written only when ticked by hand. */
const AUTO: readonly Reading[] = ["ready"];
const OPTIONAL: readonly Reading[] = ["jump", "zero"];
const EXAMPLE = "KM-5330    12,500,000\nاسپرسوساز دلونگی ECAM 22.110    ۴۵٬۰۰۰٬۰۰۰\n#57    8900000";

const label = (r: PriceRow): string => [r.displayName, rowCode(r), r.colorName].filter((p) => p !== null && p !== "" && (p === r.displayName || !r.displayName.includes(p))).join(" · ");

/**
 * Prices from a list: pasted out of Excel, a supplier's message or a note. Every line is shown as it
 * was understood - which product, which price, how far from the current one - and nothing is written
 * until the person has read that and pressed the button.
 */
export function PasteList({ rows }: { rows: PriceRow[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [unit, setUnit] = useState<PasteUnit>("toman");
  const [choice, setChoice] = useState<Record<number, number>>({});
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<PriceEdit[] | null>(null);

  const index = useMemo(() => indexProducts(rows), [rows]);
  const items = useMemo<Item[]>(() => {
    const taken = new Set<number>();
    return parsePriceList(text, unit).map((l): Item => {
      const base = { line: l.line, raw: l.raw, key: l.key, price: l.price, candidates: [] as PriceRow[], after: null };
      if (l.price === null) return { ...base, row: null, reading: "noprice" };
      const match = matchLine(l, index);
      const chosen = match.kind === "many" ? match.rows.find((r) => r.id === choice[l.line]) : undefined;
      const row = match.kind === "one" ? match.row : chosen ?? null;
      const candidates = match.kind === "many" ? match.rows : [];
      if (row === null) return { ...base, candidates, row: null, reading: match.kind === "many" ? "pick" : "none" };
      // A product named twice keeps the FIRST line's price; a later line saying otherwise is shown, not obeyed.
      if (taken.has(row.id)) return { ...base, candidates, row, reading: "repeat" };
      taken.add(row.id);
      if (row.priceBasis !== "manual") return { ...base, candidates, row, reading: "locked" };
      if (l.price === row.price) return { ...base, candidates, row, reading: "same" };
      const after = typedPrice({ price: row.price, compareAt: row.compareAtPrice }, l.price).after;
      const reading: Reading = l.price === 0 ? "zero" : isPriceJump(row.price, l.price) ? "jump" : "ready";
      return { ...base, candidates, row, after: { price: after.price, compareAtPrice: after.compareAt }, reading };
    });
  }, [text, unit, index, choice]);

  const included = (i: Item): boolean => (AUTO.includes(i.reading) && !unticked.has(i.line)) || (OPTIONAL.includes(i.reading) && ticked.has(i.line));
  const edits: PriceEdit[] = items.flatMap((i) => (i.row !== null && i.after !== null && included(i) ? [{ id: i.row.id, before: pricesOf(i.row), after: i.after }] : []));
  const count = (rs: readonly Reading[]): number => items.filter((i) => rs.includes(i.reading)).length;
  const tooMany = edits.length > PRICE_SHEET_MAX;

  function tick(i: Item, on: boolean): void {
    const move = (set: Set<number>, add: boolean): Set<number> => {
      const next = new Set(set);
      if (add) next.add(i.line);
      else next.delete(i.line);
      return next;
    };
    if (OPTIONAL.includes(i.reading)) setTicked((s) => move(s, on));
    else setUnticked((s) => move(s, !on));
  }
  function retype(next: string): void {
    setText(next);
    setChoice({});
    setTicked(new Set());
    setUnticked(new Set());
  }

  async function save(list: PriceEdit[], undoing: boolean): Promise<void> {
    setBusy(true);
    try {
      const result = await putPrices(list, undoing ? PRICE_NOTES.undo : PRICE_NOTES.paste);
      toast(undoing ? `قیمت ${faInt(result.updated)} کالا به حالت قبل برگشت.` : `${faInt(result.updated)} قیمت ثبت شد.`);
      setApplied(undoing ? null : list);
      if (!undoing) retype("");
      router.refresh();
    } catch (e) {
      if (conflictIds(e) !== null) {
        toast("قیمت بعضی از این کالاها در همین فاصله تغییر کرده است و چیزی ثبت نشد. فهرست تازه شد؛ دوباره بررسی کنید.", "error");
        router.refresh();
      } else {
        toast(e instanceof ApiError ? e.message : "ذخیره انجام نشد. اتصال را بررسی کنید.", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyList(): Promise<void> {
    const sheet = exportPriceList(rows);
    try {
      await navigator.clipboard.writeText(sheet);
      toast("فهرست کپی شد. در اکسل بچسبانید، قیمت‌ها را عوض کنید و همان ستون‌ها را دوباره اینجا بچسبانید.");
    } catch {
      // No clipboard permission: hand the same sheet over as a file instead.
      const url = URL.createObjectURL(new Blob([`${String.fromCharCode(0xfeff)}${sheet}`], { type: "text/tab-separated-values;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "namilux-prices.tsv";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <div className="price-flow">
      {applied !== null ? (
        <div className="ui-note ui-note--ok" role="status">
          <span className="grow">{faInt(applied.length)} قیمت از فهرست ثبت شد.</span>
          <Button size="sm" variant="outline" busy={busy} icon={<RotateCcw size={14} aria-hidden="true" />} onClick={() => void save(applied.map((e) => ({ id: e.id, before: e.after, after: e.before })), true)}>
            برگرداندن این تغییر
          </Button>
        </div>
      ) : null}

      <Step
        n="۱"
        title="فهرست قیمت را بچسبانید"
        hint="هر خط یک کالا: کد یا نام کالا، و بعد قیمت جدید. ستون‌های کپی‌شده از اکسل هم خوانده می‌شوند."
        actions={
          <Button variant="outline" size="sm" icon={<ClipboardCopy size={14} aria-hidden="true" />} onClick={() => void copyList()}>
            کپی فهرست فعلی برای اکسل
          </Button>
        }
      >
        <Textarea dir="auto" rows={8} className="price-paste__box" aria-label="فهرست قیمت" placeholder={EXAMPLE} value={text} onChange={(e) => retype(e.target.value)} />
        <div className="price-flow__ops">
          <span className="price-flow__label">مبلغ‌های فهرست به</span>
          <Segmented<PasteUnit> label="واحد مبلغ" value={unit} onChange={setUnit} options={[{ value: "toman", label: "تومان" }, { value: "rial", label: "ریال" }]} />
          <span className="price-flow__label">است.</span>
        </div>
      </Step>

      <Step
        n="۲"
        title="بررسی و ثبت"
        hint={items.length === 0 ? "بعد از چسباندن فهرست، هر خط همین‌جا نشان داده می‌شود: کدام کالا و چه قیمتی." : "تا «ثبت» را نزنید چیزی تغییر نمی‌کند."}
        actions={<Button disabled={edits.length === 0 || tooMany} busy={busy} onClick={() => void save(edits, false)}>ثبت {faInt(edits.length)} قیمت</Button>}
      >
        {items.length === 0 ? null : (
          <>
            <div className="price-paste__summary">
              <StatusBadge tone="ok">{faInt(count(["ready"]))} آماده</StatusBadge>
              {count(OPTIONAL) > 0 ? <StatusBadge tone="warn">{faInt(count(OPTIONAL))} نیازمند تأیید شما</StatusBadge> : null}
              {count(["pick"]) > 0 ? <StatusBadge tone="warn">{faInt(count(["pick"]))} چند کالای مشابه</StatusBadge> : null}
              {count(["none"]) > 0 ? <StatusBadge tone="danger">{faInt(count(["none"]))} پیدا نشد</StatusBadge> : null}
              {count(["same", "noprice", "locked", "repeat"]) > 0 ? <StatusBadge tone="muted">{faInt(count(["same", "noprice", "locked", "repeat"]))} بدون تغییر</StatusBadge> : null}
            </div>
            {tooMany ? <p className="ui-note ui-note--warn">در هر نوبت حداکثر {faInt(PRICE_SHEET_MAX)} قیمت ثبت می‌شود؛ فهرست را در چند نوبت بچسبانید.</p> : null}
            <div className="admin-table-scroll">
              <table className="admin-data-table is-cards price-preview">
                <thead>
                  <tr>
                    <th className="cell-check"><span className="sr-only">ثبت شود</span></th>
                    <th>در فهرست شما</th>
                    <th>کالا</th>
                    <th>قیمت فعلی</th>
                    <th>قیمت جدید</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const can = AUTO.includes(i.reading) || OPTIONAL.includes(i.reading);
                    return (
                      <tr key={i.line} data-line={i.line} data-reading={i.reading} data-off={!included(i) || undefined}>
                        <td className="cell-check">
                          {can ? <input type="checkbox" aria-label={`ثبت خط ${faInt(i.line)}`} checked={included(i)} onChange={(e) => tick(i, e.target.checked)} /> : null}
                        </td>
                        <td className="cell-primary">
                          <span className="price-paste__raw" dir="auto">{i.key === "" ? i.raw.trim() : i.key}</span>
                        </td>
                        <td data-label="کالا">
                          {i.candidates.length > 0 ? (
                            <Select aria-label={`کالای خط ${faInt(i.line)}`} className="price-paste__pick" value={i.row === null ? "" : String(i.row.id)} onChange={(e) => setChoice((c) => ({ ...c, [i.line]: Number(e.target.value) }))}>
                              <option value="">انتخاب کنید…</option>
                              {i.candidates.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
                            </Select>
                          ) : i.row !== null ? (
                            <span className="cell-name">{label(i.row)}</span>
                          ) : (
                            <span className="cell-muted">—</span>
                          )}
                        </td>
                        <td data-label="قیمت فعلی">{i.row === null ? "—" : <bdi className="money">{i.row.price === 0 ? "استعلامی" : formatToman(i.row.price)}</bdi>}</td>
                        <td data-label="قیمت جدید" className="cell-num">
                          {i.price === null ? "—" : <bdi className="money">{formatToman(i.price)}</bdi>}
                          {i.row !== null && i.after !== null ? <Delta before={i.row.price} after={i.after.price} className="price-preview__delta" /> : null}
                        </td>
                        <td data-label="وضعیت"><StatusBadge tone={READING[i.reading].tone}>{READING[i.reading].label}</StatusBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        {items.length === 0 ? <EmptyState text="هنوز فهرستی چسبانده نشده است." hint="نمی‌دانید از کجا شروع کنید؟ «کپی فهرست فعلی برای اکسل» همهٔ کالاها را با قیمت امروزشان می‌دهد." /> : null}
      </Step>
    </div>
  );
}
