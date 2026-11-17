"use client";
import { faInt } from "@namilux/core/client";
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { fa } from "@/i18n/fa";

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
/** The Persian week starts on Saturday. */
const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Gregorian → Jalali (Khayyam-based arithmetic, valid 1178–3177 AH). */
export function toJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + (gdm[gm - 1] ?? 0);
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

/** Jalali → Gregorian. */
export function toGregorian(jy: number, jm: number, jd: number): { gy: number; gm: number; gd: number } {
  const jy2 = jy + 1595;
  let days = -355668 + 365 * jy2 + div(jy2, 33) * 8 + div((jy2 % 33) + 3, 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const sal = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > (sal[gm] ?? 0); gm += 1) gd -= sal[gm] ?? 0;
  return { gy, gm, gd };
}

/** Days in a Jalali month; Esfand is 29 or 30, measured rather than tabled so leap years need no rule here. */
function monthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const a = toGregorian(jy, 12, 1);
  const b = toGregorian(jy + 1, 1, 1);
  return Math.round((Date.UTC(b.gy, b.gm - 1, b.gd) - Date.UTC(a.gy, a.gm - 1, a.gd)) / 86_400_000);
}

/** Column of a Jalali day in a Saturday-first week (0 = Saturday). */
function weekday(jy: number, jm: number, jd: number): number {
  const g = toGregorian(jy, jm, jd);
  return (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7;
}

function parts(iso: string | null): { jy: number; jm: number; jd: number; h: number; mi: number } | null {
  if (iso === null) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { ...j, h: d.getHours(), mi: d.getMinutes() };
}

function build(jy: number, jm: number, jd: number, h: number, mi: number): string {
  const g = toGregorian(jy, jm, jd);
  return new Date(g.gy, g.gm - 1, g.gd, h, mi, 0, 0).toISOString();
}

function todayJ(): { jy: number; jm: number; jd: number } {
  const n = new Date();
  return toJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

const pad2 = (n: number): string => faInt(n).padStart(2, "۰");

/**
 * A Jalali date (and, `withTime`, an hour) as one field: the value in words, a calendar under it.
 * The value is an ISO timestamp or null, exactly as before; the four dropdowns it replaces
 * (روز · ماه · سال · ساعت) wrote the same ISO, so no form, filter or API changed shape.
 */
export function JalaliDate({ value, onChange, withTime = false }: { value: string | null; onChange: (iso: string | null) => void; withTime?: boolean }) {
  const p = parts(value);
  const now = todayJ();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ jy: number; jm: number }>(() => (p === null ? { jy: now.jy, jm: now.jm } : { jy: p.jy, jm: p.jm }));
  const wrap = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // Re-centre the calendar on the value whenever it is opened.
  useEffect(() => {
    if (!open) return;
    const cur = parts(value);
    const t = todayJ();
    setView(cur === null ? { jy: t.jy, jm: t.jm } : { jy: cur.jy, jm: cur.jm });
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hour = p?.h ?? (withTime ? 12 : 0);
  const minute = p?.mi ?? 0;
  const pick = (jd: number): void => {
    onChange(build(view.jy, view.jm, jd, hour, minute));
    if (!withTime) setOpen(false);
  };
  const shift = (delta: number): void => {
    setView((v) => {
      const idx = v.jy * 12 + (v.jm - 1) + delta;
      return { jy: Math.floor(idx / 12), jm: (idx % 12) + 1 };
    });
  };

  const label =
    p === null
      ? withTime
        ? fa["date.pickTime"]
        : fa["date.pick"]
      : `${faInt(p.jd)} ${MONTHS[p.jm - 1] ?? ""} ${faInt(p.jy)}${withTime ? ` · ${pad2(p.h)}:${pad2(p.mi)}` : ""}`;

  const len = monthLength(view.jy, view.jm);
  const lead = weekday(view.jy, view.jm, 1);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: len }, (_, i) => i + 1)];

  return (
    <div ref={wrap} className="ui-date" data-open={open || undefined}>
      <button type="button" className="ui-date__trigger ui-input" aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} data-empty={p === null || undefined}>
        <CalendarDays size={16} aria-hidden="true" />
        <span>{label}</span>
      </button>
      {p !== null ? (
        <button type="button" className="ui-date__clear" aria-label={fa["date.clear"]} onClick={() => onChange(null)}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      {open ? (
        <div id={panelId} className="ui-date__panel" role="dialog" aria-label={fa["date.pick"]}>
          <div className="ui-date__head">
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon-sm" aria-label={fa["date.prevMonth"]} onClick={() => shift(-1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <span className="ui-date__title">
              {MONTHS[view.jm - 1]} {faInt(view.jy)}
            </span>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--icon-sm" aria-label={fa["date.nextMonth"]} onClick={() => shift(1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="ui-date__grid" role="grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="ui-date__dow" aria-hidden="true">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d === null ? (
                <span key={`e${String(i)}`} />
              ) : (
                <button
                  key={d}
                  type="button"
                  className="ui-date__day"
                  aria-pressed={p !== null && p.jy === view.jy && p.jm === view.jm && p.jd === d}
                  data-today={now.jy === view.jy && now.jm === view.jm && now.jd === d ? "" : undefined}
                  data-friday={(lead + d - 1) % 7 === 6 ? "" : undefined}
                  onClick={() => pick(d)}
                >
                  {faInt(d)}
                </button>
              ),
            )}
          </div>
          {withTime ? (
            <label className="ui-date__time">
              <span>{fa["date.time"]}</span>
              <select
                className="ui-select"
                value={String(hour)}
                onChange={(e) => {
                  const base = p ?? { ...now, h: hour, mi: minute };
                  onChange(build(base.jy, base.jm, base.jd, Number(e.target.value), base.mi));
                }}
              >
                {Array.from({ length: 24 }, (_, i) => i).map((h) => (
                  <option key={h} value={h}>
                    {pad2(h)}:۰۰
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="ui-date__foot">
            <button
              type="button"
              className="ui-btn ui-btn--soft ui-btn--sm"
              onClick={() => {
                onChange(build(now.jy, now.jm, now.jd, withTime ? new Date().getHours() : 0, 0));
                if (!withTime) setOpen(false);
              }}
            >
              {fa["date.today"]}
            </button>
            {p !== null ? (
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {fa["date.clear"]}
              </button>
            ) : null}
            {withTime ? (
              <button type="button" className="ui-btn ui-btn--default ui-btn--sm" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(false)}>
                {fa["common.confirm"]}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
