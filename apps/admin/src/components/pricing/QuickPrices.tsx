"use client";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Check, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { PRICE_EDIT_MAX, faInt, formatToman, isPriceJump, typedPrice } from "@namilux/core/client";
import { Button, Checkbox, EmptyState, Select } from "@/components/kit";
import { ApiError, api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { conflictIds, patchPrices } from "@/lib/price-save";
import { PRICE_NOTES, changedOn, digitsToToman, jumpLabel, lastChangedLabel, matchesTokens, pricesOf, queryTokens, samePrices, searchHaystack, tehranDay } from "@/lib/pricing";
import type { PriceRow, Prices } from "@/lib/pricing";
import { PriceInput } from "./PriceInput";
import { Delta, ProductCell } from "./parts";

type Option = { id: number; name: string };
type Show = "all" | "available" | "unpriced" | "stale" | "sale";
type Sort = "name" | "oldest" | "newest" | "price";
type View = { q: string; brand: string; category: string; show: Show; sort: Sort };
type Field = "price" | "compare";

/**
 * What a row is doing besides showing its price. Absent means "nothing": the row is at rest.
 *   • `ask` - the typed price was not written: it is zero, or so far from the current one that a
 *              dropped or doubled zero is the likelier story. A second yes writes it.
 *   • `saved` carries the price it replaced, so the change can be taken back from the row itself.
 */
type RowStatus =
  | { kind: "saving" }
  | { kind: "saved"; previous: Prices | null; saleEnded: boolean; undone: boolean }
  | { kind: "ask"; price: number; why: "jump" | "zero" }
  | { kind: "error"; message: string; after: Prices }
  | { kind: "conflict" }
  | { kind: "invalid"; message: string };

type RowApi = {
  commitPrice: (id: number, price: number, viaEnter: boolean) => "same" | "queued" | "ask";
  commitCompare: (id: number, compareAt: number | null) => boolean;
  confirm: (id: number) => void;
  retry: (id: number) => void;
  undo: (id: number) => void;
  dismiss: (id: number) => void;
  move: (id: number, by: 1 | -1, field: Field) => void;
  register: (id: number, field: Field, el: HTMLInputElement | null) => void;
};

const PAGE = 60;
const DEFAULT_VIEW: View = { q: "", brand: "", category: "", show: "all", sort: "name" };
const COMPARE_KEY = "nl.prices.compare";
const SHOWS: readonly { key: Show; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "available", label: "موجود" },
  { key: "stale", label: "امروز تغییر نکرده" },
  { key: "unpriced", label: "بدون قیمت" },
  { key: "sale", label: "تخفیف‌دار" },
];

const inShow = (r: PriceRow, show: Show, today: string): boolean =>
  show === "all" ? true
    : show === "available" ? r.available
      : show === "unpriced" ? r.price === 0
        : show === "sale" ? r.compareAtPrice !== null
          : !changedOn(r.priceUpdatedAt, today);

const stamp = (r: PriceRow): number => (r.priceUpdatedAt === null ? 0 : Date.parse(r.priceUpdatedAt));

/**
 * The rows a view shows and how many each chip would show, taken from the rows as they are NOW.
 * The result is kept until the view itself changes: a row repriced a moment ago must not jump to
 * the end of «قدیمی‌ترین» or vanish from «امروز تغییر نکرده» under the hand that is typing down the list.
 */
function listFor(rows: readonly PriceRow[], hay: Map<number, string>, categories: readonly (Option & { ids: number[] })[], view: View, today: string) {
  const tokens = queryTokens(view.q);
  const cats = categories.find((c) => String(c.id) === view.category)?.ids;
  const base = rows.filter((r) =>
    (tokens.length === 0 || matchesTokens(hay.get(r.id) ?? "", tokens)) &&
    (view.brand === "" || String(r.brandId) === view.brand) &&
    (cats === undefined || r.categoryIds.some((id) => cats.includes(id))));
  const counts = Object.fromEntries(SHOWS.map((s) => [s.key, base.filter((r) => inShow(r, s.key, today)).length])) as Record<Show, number>;
  const shown = base.filter((r) => inShow(r, view.show, today));
  if (view.sort === "oldest") shown.sort((a, b) => stamp(a) - stamp(b));
  else if (view.sort === "newest") shown.sort((a, b) => stamp(b) - stamp(a));
  else if (view.sort === "price") shown.sort((a, b) => b.price - a.price);
  return { ids: shown.map((r) => r.id), counts };
}

export function QuickPrices({ initialRows, brands, categories, now: loadedAt }: {
  initialRows: PriceRow[];
  brands: Option[];
  categories: (Option & { ids: number[] })[];
  /** The server's clock when the rows were read, so «۳ روز پیش» is the same text on both sides of hydration. */
  now: number;
}) {
  const hay = useMemo(() => new Map(initialRows.map((r) => [r.id, searchHaystack(r)])), [initialRows]);
  const [rows, setRows] = useState(initialRows);
  const [now, setNow] = useState(loadedAt);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [listing, setListing] = useState(() => listFor(initialRows, hay, categories, DEFAULT_VIEW, tehranDay(loadedAt)));
  const [limit, setLimit] = useState(PAGE);
  const [showCompare, setShowCompare] = useState(false);
  const [status, setStatus] = useState<Record<number, RowStatus>>({});

  // The saver works outside React's render cycle - a request finishing must see the prices the
  // previous one wrote, not the ones the last render happened to close over.
  const truth = useRef(new Map<number, Prices>(initialRows.map((r) => [r.id, pricesOf(r)])));
  const statusNow = useRef<Record<number, RowStatus>>({});
  // Capture the baseline when the edit is made. A conflict refresh must never silently turn an
  // old edit into a write over a price the operator has not reviewed.
  const queue = useRef(new Map<number, { before: Prices; after: Prices; undo: boolean }>());
  /** What the request on the wire will leave each of its rows at. */
  const flying = useRef(new Map<number, Prices>());
  const sending = useRef(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusNext = useRef<string | null>(null);
  const order = useRef<number[]>([]);
  const shownCount = useRef(0);

  const put = useCallback((id: number, next: RowStatus | null): void => {
    const all = { ...statusNow.current };
    if (next === null) delete all[id];
    else all[id] = next;
    statusNow.current = all;
    setStatus(all);
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COMPARE_KEY) === "1") setShowCompare(true);
    } catch {
      /* storage is a convenience; the column simply starts hidden */
    }
  }, []);

  // A fresh read from the server (Back/Forward re-reads every page) replaces the rows - unless a save
  // is still on its way, in which case the screen already knows more than that read does.
  const adopted = useRef(initialRows);
  useEffect(() => {
    if (adopted.current === initialRows) return;
    adopted.current = initialRows;
    if (sending.current || queue.current.size > 0) return;
    truth.current = new Map(initialRows.map((r) => [r.id, pricesOf(r)]));
    setRows(initialRows);
    setNow(loadedAt);
  }, [initialRows, loadedAt]);

  const flush = useCallback(async (): Promise<void> => {
    if (sending.current) return;
    const first = queue.current.values().next().value;
    if (first === undefined) return;
    // An undo is noted as one in the price history, so it never shares a request with fresh edits.
    const batch = [...queue.current.entries()].filter(([, q]) => q.undo === first.undo).slice(0, PRICE_EDIT_MAX);
    for (const [id] of batch) queue.current.delete(id);
    const edits = batch.flatMap(([id, q]) => {
      const current = truth.current.get(id);
      if (current === undefined || !samePrices(current, q.before)) {
        put(id, { kind: "conflict" });
        return [];
      }
      return samePrices(q.before, q.after) ? [] : [{ id, ...q }];
    });
    const sent = new Set(edits.map((e) => e.id));
    for (const [id] of batch) if (!sent.has(id) && statusNow.current[id]?.kind === "saving") put(id, null);
    if (edits.length === 0) return void flush();

    sending.current = true;
    for (const e of edits) flying.current.set(e.id, e.after);
    try {
      await patchPrices(edits.map(({ id, before, after }) => ({ id, before, after })), first.undo ? PRICE_NOTES.undo : undefined);
      const at = new Date();
      const done = new Map(edits.map((e) => [e.id, e]));
      for (const e of edits) truth.current.set(e.id, e.after);
      setRows((prev) => prev.map((r) => {
        const e = done.get(r.id);
        return e === undefined ? r : { ...r, ...e.after, priceUpdatedAt: at.toISOString() };
      }));
      setNow(at.getTime());
      for (const e of edits) {
        // A newer edit of the same row is already waiting: it owns the row's status now.
        if (queue.current.has(e.id) || statusNow.current[e.id]?.kind !== "saving") continue;
        put(e.id, { kind: "saved", previous: e.undo ? null : e.before, saleEnded: e.before.compareAtPrice !== null && e.after.compareAtPrice === null && e.after.price !== e.before.price, undone: e.undo });
      }
    } catch (err) {
      const conflicts = conflictIds(err);
      if (conflicts !== null) {
        // Someone else repriced one of these rows. Nothing in the request was written, so the rows
        // are read again, the untouched edits go back in the queue, and only the contested row asks.
        const stale = new Set(conflicts);
        try {
          const fresh = await api<{ rows: PriceRow[] }>("/api/products/prices");
          truth.current = new Map(fresh.rows.map((r) => [r.id, pricesOf(r)]));
          setRows(fresh.rows);
          setNow(Date.now());
        } catch {
          for (const e of edits) stale.add(e.id);
        }
        for (const e of edits) {
          if (stale.has(e.id)) {
            queue.current.delete(e.id);
            put(e.id, { kind: "conflict" });
          } else {
            // The whole request was rejected, including this uncontested row. A later local edit
            // replaces that failed edit but still starts from its original, unmodified baseline.
            const pending = queue.current.get(e.id);
            queue.current.set(e.id, { before: e.before, after: pending?.after ?? e.after, undo: pending?.undo ?? e.undo });
          }
        }
      } else {
        const message = err instanceof ApiError ? err.brief : "اتصال برقرار نشد.";
        for (const e of edits) {
          const pending = queue.current.get(e.id);
          queue.current.delete(e.id);
          put(e.id, { kind: "error", message, after: pending?.after ?? e.after });
        }
      }
    } finally {
      sending.current = false;
      flying.current.clear();
      if (queue.current.size > 0) void flush();
    }
  }, [put]);

  const enqueue = useCallback((id: number, after: Prices, undo = false): void => {
    const before = queue.current.get(id)?.before ?? flying.current.get(id) ?? truth.current.get(id);
    if (before === undefined) return;
    queue.current.set(id, { before, after, undo });
    put(id, { kind: "saving" });
    void flush();
  }, [flush, put]);

  const rowApi = useMemo<RowApi>(() => ({
    commitPrice(id, price, viaEnter) {
      const before = truth.current.get(id);
      if (before === undefined) return "same";
      // What the row will hold once everything already queued or on the wire has landed: a second
      // edit is judged against that, not against a price that is about to be replaced.
      const pending = queue.current.get(id)?.after ?? flying.current.get(id);
      const from = pending ?? before;
      const current = statusNow.current[id];
      if (price === from.price) {
        if (pending !== undefined) return "queued";
        if (current?.kind === "ask" || current?.kind === "invalid" || current?.kind === "error") put(id, null);
        return "same";
      }
      const why = price === 0 ? "zero" : isPriceJump(from.price, price) ? "jump" : null;
      // Only a deliberate second Enter (or the row's own «بله» button) answers the question: leaving
      // the box must never be read as a yes.
      const answered = viaEnter && current?.kind === "ask" && current.price === price;
      if (why !== null && !answered) {
        put(id, { kind: "ask", price, why });
        return "ask";
      }
      enqueue(id, { price, compareAtPrice: typedPrice({ price: from.price, compareAt: from.compareAtPrice }, price).after.compareAt });
      return "queued";
    },
    commitCompare(id, compareAt) {
      const before = truth.current.get(id);
      if (before === undefined) return true;
      const from = queue.current.get(id)?.after ?? flying.current.get(id) ?? before;
      if (from.compareAtPrice === compareAt) return true;
      if (compareAt !== null && (from.price === 0 || compareAt <= from.price)) {
        put(id, { kind: "invalid", message: from.price === 0 ? "کالای بدون قیمت نمی‌تواند قیمت قبل از تخفیف داشته باشد." : "قیمت قبل از تخفیف باید بیشتر از قیمت فروش باشد." });
        return false;
      }
      enqueue(id, { price: from.price, compareAtPrice: compareAt });
      return true;
    },
    confirm(id) {
      const s = statusNow.current[id];
      const before = truth.current.get(id);
      if (s?.kind !== "ask" || before === undefined) return;
      const from = queue.current.get(id)?.after ?? flying.current.get(id) ?? before;
      enqueue(id, { price: s.price, compareAtPrice: typedPrice({ price: from.price, compareAt: from.compareAtPrice }, s.price).after.compareAt });
    },
    retry(id) {
      const s = statusNow.current[id];
      if (s?.kind === "error") enqueue(id, s.after);
    },
    undo(id) {
      const s = statusNow.current[id];
      if (s?.kind === "saved" && s.previous !== null) enqueue(id, s.previous, true);
    },
    dismiss(id) {
      if (statusNow.current[id] !== undefined && statusNow.current[id]?.kind !== "saving") put(id, null);
    },
    move(id, by, field) {
      const ids = order.current;
      const editable = (n: number | undefined): n is number => n !== undefined && inputs.current.has(`${String(n)}:price`);
      let i = ids.indexOf(id) + by;
      // Rows the browser has not been given yet: show the next stretch and land on its first row.
      if (by === 1 && i >= shownCount.current && i < ids.length) {
        focusNext.current = `${String(ids[i])}:${field}`;
        setLimit((n) => n + PAGE);
        return;
      }
      while (i >= 0 && i < shownCount.current && !editable(ids[i])) i += by;
      const el = inputs.current.get(`${String(ids[i])}:${field}`);
      if (el !== undefined) {
        el.focus();
        el.select();
      }
    },
    register(id, field, el) {
      const key = `${String(id)}:${field}`;
      if (el === null) inputs.current.delete(key);
      else inputs.current.set(key, el);
    },
  }), [enqueue, put]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const shown = listing.ids.slice(0, limit);
  const today = tehranDay(now);
  const changedToday = useMemo(() => rows.filter((r) => changedOn(r.priceUpdatedAt, today)).length, [rows, today]);
  const states = Object.values(status);
  const saving = states.filter((s) => s.kind === "saving").length;
  const open = states.filter((s) => s.kind === "ask" || s.kind === "error" || s.kind === "conflict" || s.kind === "invalid").length;
  const savedAny = states.some((s) => s.kind === "saved");

  useEffect(() => {
    order.current = listing.ids;
    shownCount.current = Math.min(limit, listing.ids.length);
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    const el = inputs.current.get(key);
    if (el !== undefined) {
      el.focus();
      el.select();
    }
  }, [listing, limit]);

  useEffect(() => {
    if (saving === 0 && open === 0) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saving, open]);

  function change(patch: Partial<View>): void {
    const next = { ...view, ...patch };
    setView(next);
    setListing(listFor(rows, hay, categories, next, tehranDay(Date.now())));
    setLimit(PAGE);
  }
  function toggleCompare(on: boolean): void {
    setShowCompare(on);
    try {
      window.localStorage.setItem(COMPARE_KEY, on ? "1" : "0");
    } catch {
      /* not remembered, nothing else changes */
    }
  }
  function searchKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== "Enter" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const firstEditable = shown.find((id) => inputs.current.has(`${String(id)}:price`));
    const el = firstEditable === undefined ? undefined : inputs.current.get(`${String(firstEditable)}:price`);
    if (el !== undefined) {
      el.focus();
      el.select();
    }
  }

  const filtered = view.q !== "" || view.brand !== "" || view.category !== "" || view.show !== "all";

  return (
    <div className="price-quick" data-testid="quick-prices">
      <div className="price-toolbar">
        <div className="price-toolbar__row">
          <label className="data-filters__search price-toolbar__search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              className="ui-input"
              aria-label="جستجوی نام یا کد کالا"
              placeholder="نام، مدل یا کد کالا…"
              enterKeyHint="search"
              autoComplete="off"
              value={view.q}
              onChange={(e) => change({ q: e.target.value })}
              onKeyDown={searchKey}
            />
          </label>
          <Select aria-label="برند" className="price-toolbar__select" value={view.brand} onChange={(e) => change({ brand: e.target.value })}>
            <option value="">همهٔ برندها</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select aria-label="دسته" className="price-toolbar__select" value={view.category} onChange={(e) => change({ category: e.target.value })}>
            <option value="">همهٔ دسته‌ها</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="ترتیب" className="price-toolbar__select price-toolbar__sort" value={view.sort} onChange={(e) => change({ sort: e.target.value as Sort })}>
            <option value="name">به ترتیب نام</option>
            <option value="oldest">قدیمی‌ترین قیمت‌ها اول</option>
            <option value="newest">تازه‌ترین قیمت‌ها اول</option>
            <option value="price">گران‌ترین اول</option>
          </Select>
        </div>
        <div className="price-toolbar__row">
          <div className="data-views price-toolbar__views" role="group" aria-label="نمایش">
            {SHOWS.map((s) => (
              <button key={s.key} type="button" className={cn("data-views__chip", view.show === s.key && "is-active")} aria-pressed={view.show === s.key} onClick={() => change({ show: s.key })}>
                {s.label}
                {s.key === "all" ? null : <span className="price-chip__n">{faInt(listing.counts[s.key])}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="price-summary">
        <span>
          <b>{faInt(listing.ids.length)}</b> کالا
          {changedToday > 0 ? (
            <>
              {" · "}
              <Link href="/products/prices/history" className="ui-link-btn">امروز {faInt(changedToday)} قیمت تغییر کرده</Link>
            </>
          ) : null}
        </span>
        <span className="price-summary__state" role="status" aria-live="polite">
          {saving > 0 ? (
            <><span className="ui-spinner" aria-hidden="true" /> در حال ذخیره…</>
          ) : open > 0 ? (
            <span className="price-summary__warn"><TriangleAlert size={15} aria-hidden="true" /> {faInt(open)} قیمت هنوز ذخیره نشده</span>
          ) : savedAny ? (
            <span className="price-summary__ok"><Check size={15} aria-hidden="true" /> همهٔ تغییرها ذخیره شد</span>
          ) : (
            <span className="price-summary__hint">قیمت را بنویسید و <kbd>Enter</kbd> بزنید؛ همان لحظه ذخیره می‌شود.</span>
          )}
        </span>
        <Checkbox className="price-summary__compare" label="ستون قیمت قبل از تخفیف" checked={showCompare} onChange={(e) => toggleCompare(e.target.checked)} />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          text="کالایی با این مشخصات پیدا نشد."
          {...(filtered ? { action: <Button variant="outline" size="sm" onClick={() => change(DEFAULT_VIEW)}>پاک کردن فیلترها</Button> } : {})}
        />
      ) : (
        <div className="price-list" role="table" aria-label="قیمت کالاها" data-compare={showCompare || undefined}>
          <div className="price-list__head" role="row">
            <span role="columnheader">کالا</span>
            <span role="columnheader">قیمت فروش (تومان)</span>
            {showCompare ? <span role="columnheader">قبل از تخفیف (تومان)</span> : null}
            <span role="columnheader">وضعیت</span>
            <span role="columnheader">آخرین تغییر</span>
          </div>
          {shown.map((id) => {
            const row = byId.get(id);
            return row === undefined ? null : <Row key={id} row={row} status={status[id]} showCompare={showCompare} now={now} api={rowApi} />;
          })}
        </div>
      )}
      {listing.ids.length > limit ? (
        <div className="price-more">
          <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
            نمایش {faInt(Math.min(PAGE, listing.ids.length - limit))} کالای بعدی
          </Button>
          <span>{faInt(limit)} از {faInt(listing.ids.length)}</span>
        </div>
      ) : null}
    </div>
  );
}

const digitsOf = (n: number | null): string => (n === null || n === 0 ? "" : String(n));

const Row = memo(function Row({ row, status, showCompare, now, api }: { row: PriceRow; status: RowStatus | undefined; showCompare: boolean; now: number; api: RowApi }) {
  const locked = row.priceBasis !== "manual";
  const base = digitsOf(row.price);
  const compareBase = digitsOf(row.compareAtPrice);
  const [text, setText] = useState(base);
  const [compare, setCompare] = useState(compareBase);
  const [seen, setSeen] = useState(`${base}|${compareBase}`);
  const [focused, setFocused] = useState(false);
  // The stored price moved (a save landed, an undo, a fresh read): the boxes follow it - except the
  // one being typed in right now, which keeps what the hand is writing.
  if (seen !== `${base}|${compareBase}`) {
    setSeen(`${base}|${compareBase}`);
    if (!focused) {
      setText(base);
      setCompare(compareBase);
    }
  }
  const typed = digitsToToman(text);
  const dirty = !locked && text !== "" && text !== base && typed !== null;
  const kind = status?.kind;
  const state = kind ?? (dirty ? "dirty" : "rest");

  function submitPrice(viaEnter: boolean): boolean {
    // An emptied box is "leave it as it was", never "make it free": zero has to be typed.
    if (text === "") setText(base);
    const price = text === "" ? row.price : typed;
    if (price === null) return false;
    return api.commitPrice(row.id, price, viaEnter) !== "ask";
  }
  function submitCompare(): boolean {
    if (compare === compareBase) return true;
    return api.commitCompare(row.id, compare === "" ? null : digitsToToman(compare));
  }
  function reset(): void {
    setText(base);
    setCompare(compareBase);
    api.dismiss(row.id);
  }
  function keys(e: KeyboardEvent<HTMLInputElement>, field: Field): void {
    if (e.key === "Enter") {
      e.preventDefault();
      if (field === "price" ? submitPrice(true) : submitCompare()) api.move(row.id, e.shiftKey ? -1 : 1, field);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      api.move(row.id, e.key === "ArrowDown" ? 1 : -1, field);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // The old figure goes back in the box and is selected at once, so the very next key replaces
      // it instead of adding to it.
      flushSync(reset);
      e.currentTarget.select();
    }
  }

  return (
    <div className="price-row" role="row" data-product-id={row.id} data-state={state}>
      <div className="price-row__product" role="cell">
        <ProductCell row={row}>
          <span className="price-row__when-inline"> · {lastChangedLabel(row.priceUpdatedAt, now)}</span>
        </ProductCell>
      </div>
      <div className="price-row__price" role="cell">
        {locked ? (
          <span className="price-row__locked">
            <bdi className="money">{row.price === 0 ? "استعلامی" : formatToman(row.price)}</bdi>
            <Link href="/products/prices/fx" className="ui-link-btn">قیمت ارزی</Link>
          </span>
        ) : (
          <PriceInput
            ref={(el) => api.register(row.id, "price", el)}
            aria-label={`قیمت فروش ${row.displayName}`}
            aria-invalid={kind === "error" || kind === "invalid" || undefined}
            data-price-field="price"
            enterKeyHint="next"
            placeholder="استعلامی"
            value={text}
            onDigits={setText}
            onFocus={(e) => {
              setFocused(true);
              e.target.select();
            }}
            onBlur={() => {
              setFocused(false);
              if (dirty) submitPrice(false);
              else if (text === "") setText(base);
            }}
            onKeyDown={(e) => keys(e, "price")}
          />
        )}
      </div>
      {showCompare ? (
        <div className="price-row__compare" role="cell">
          {locked ? null : (
            <PriceInput
              ref={(el) => api.register(row.id, "compare", el)}
              aria-label={`قیمت قبل از تخفیف ${row.displayName}`}
              data-price-field="compareAtPrice"
              enterKeyHint="next"
              placeholder="بدون تخفیف"
              value={compare}
              onDigits={setCompare}
              onFocus={(e) => {
                setFocused(true);
                e.target.select();
              }}
              onBlur={() => {
                setFocused(false);
                submitCompare();
              }}
              onKeyDown={(e) => keys(e, "compare")}
            />
          )}
        </div>
      ) : null}
      <div className="price-row__state" role="cell">
        {kind === "saving" ? (
          <span className="price-state"><span className="ui-spinner" aria-hidden="true" /> در حال ذخیره…</span>
        ) : status?.kind === "saved" ? (
          <span className="price-state price-state--ok">
            <Check size={15} aria-hidden="true" />
            {status.undone ? "برگردانده شد" : "ذخیره شد"}
            {status.previous !== null ? <Delta before={status.previous.price} after={row.price} /> : null}
            {status.saleEnded ? <span className="price-state__note">تخفیف برداشته شد</span> : null}
            {status.previous !== null ? (
              <button type="button" className="ui-link-btn" tabIndex={-1} onClick={() => api.undo(row.id)}>
                <RotateCcw size={13} aria-hidden="true" /> برگرداندن
              </button>
            ) : null}
          </span>
        ) : dirty && typed !== null && kind === undefined ? (
          <span className="price-state price-state--draft">
            <Delta before={row.price} after={typed} />
            <kbd>Enter</kbd>
          </span>
        ) : !showCompare && row.compareAtPrice !== null && kind === undefined ? (
          <span className="price-state price-state--muted">قبل از تخفیف: <bdi>{formatToman(row.compareAtPrice)}</bdi></span>
        ) : null}
      </div>
      <div className="price-row__when" role="cell">{lastChangedLabel(row.priceUpdatedAt, now)}</div>
      {status?.kind === "ask" ? (
        <div className="price-row__strip price-row__strip--warn" role="alert">
          <span>
            {status.why === "zero"
              ? "قیمت صفر یعنی این کالا روی سایت «استعلام قیمت» می‌شود."
              : <>این قیمت <b>{jumpLabel(row.price, status.price)}</b> است: <bdi>{formatToman(row.price)}</bdi> ← <bdi>{formatToman(status.price)}</bdi>. یک صفر کم یا زیاد نشده؟</>}
          </span>
          <span className="price-row__strip-actions">
            <Button size="sm" onClick={() => api.confirm(row.id)}>بله، ثبت شود</Button>
            <Button size="sm" variant="outline" onClick={reset}>نه، برگردان</Button>
          </span>
        </div>
      ) : status?.kind === "error" ? (
        <div className="price-row__strip price-row__strip--danger" role="alert">
          <span>ذخیره نشد. {status.message}</span>
          <span className="price-row__strip-actions">
            <Button size="sm" onClick={() => api.retry(row.id)}>تلاش دوباره</Button>
            <Button size="sm" variant="outline" onClick={reset}>انصراف</Button>
          </span>
        </div>
      ) : status?.kind === "conflict" ? (
        <div className="price-row__strip price-row__strip--danger" role="alert">
          <span>قیمت این کالا همین حالا از جای دیگری تغییر کرده بود و قیمت شما ثبت نشد. قیمت تازه را می‌بینید؛ اگر لازم است دوباره وارد کنید.</span>
          <span className="price-row__strip-actions">
            <Button size="sm" variant="outline" onClick={reset}>متوجه شدم</Button>
          </span>
        </div>
      ) : status?.kind === "invalid" ? (
        <div className="price-row__strip price-row__strip--danger" role="alert">
          <span>{status.message}</span>
          <span className="price-row__strip-actions">
            <Button size="sm" variant="outline" onClick={reset}>متوجه شدم</Button>
          </span>
        </div>
      ) : null}
    </div>
  );
});
