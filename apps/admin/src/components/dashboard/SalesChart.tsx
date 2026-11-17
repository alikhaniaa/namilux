"use client";
import { useState } from "react";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import type { DashboardDay, SalesChannel } from "@namilux/core/client";
import { fa } from "@/i18n/fa";

const TOMAN = "تومان";

/** A clean axis step: 1, 2 or 5 × a power of ten, so the ticks read 0 · 20 · 40 · 60 میلیون. */
function niceStep(max: number, ticks: number): number {
  if (max <= 0) return 1;
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow;
}

/** An axis label: «۲۰ میلیون», «۱٫۵ میلیارد», «۸۰۰ هزار». */
function compactToman(n: number): string {
  if (n === 0) return "۰";
  if (n >= 1_000_000_000) {
    const tenths = Math.round(n / 100_000_000);
    const whole = Math.trunc(tenths / 10);
    const rest = tenths % 10;
    return `${faInt(whole)}${rest === 0 ? "" : `٫${faInt(rest)}`} ${fa["dash.unit.billion"]}`;
  }
  if (n >= 1_000_000) return `${faInt(Math.round(n / 1_000_000))} ${fa["dash.unit.million"]}`;
  return `${faInt(Math.round(n / 1000))} ${fa["dash.unit.thousand"]}`;
}

const dayLabel = (day: string): string => formatJalali(`${day}T12:00:00+03:30`, "short");

/**
 * Paid sales per day over the last 30 days, one column per day, stacked by storefront (namilux.ir at
 * the baseline, the instalment site above it) when both are shown. Time runs with the reading
 * direction (newest at the start of the line in RTL). The hover tooltip gives each day's figures;
 * the legend carries the period totals; a visually hidden table carries every value for a screen
 * reader. One series (a confined role) draws no legend: the card title names it.
 */
export function SalesChart({ series, sites }: { series: DashboardDay[]; sites: SalesChannel[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = series.map((d) => sites.reduce((s, c) => s + d.revenue[c], 0));
  const max = Math.max(0, ...totals);
  const step = niceStep(max, 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const sum = (c: SalesChannel): number => series.reduce((s, d) => s + d.revenue[c], 0);
  // The newest day at the reading start: the series is oldest-first, the row lays out from the start edge.
  const days = [...series].reverse();
  const active = hover === null ? null : days[hover];

  return (
    <div className="chart">
      {sites.length > 1 ? (
        <ul className="chart__legend">
          {sites.map((c) => (
            <li key={c}>
              <span className="chart__key" data-site={c} aria-hidden="true" />
              <span>{fa[`channel.${c}`]}</span>
              <b>{formatToman(sum(c))}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chart__frame" onMouseLeave={() => setHover(null)}>
        <div className="chart__axis" aria-hidden="true">
          {[...ticks].reverse().map((t) => (
            <span key={t}>{compactToman(t)}</span>
          ))}
        </div>
        <div className="chart__plot" aria-hidden="true">
          <div className="chart__grid">
            {ticks.map((t) => (
              <span key={t} style={{ insetBlockEnd: `${String((t / top) * 100)}%` }} />
            ))}
          </div>
          <div className="chart__cols">
            {days.map((d, i) => {
              const total = sites.reduce((s, c) => s + d.revenue[c], 0);
              return (
                <div key={d.day} className="chart__col" data-active={hover === i || undefined} onMouseEnter={() => setHover(i)}>
                  <div className="chart__stack" style={{ blockSize: `${String(total === 0 ? 0 : Math.max(2, (total / top) * 100))}%` }}>
                    {sites.map((c) =>
                      d.revenue[c] > 0 ? <span key={c} className="chart__seg" data-site={c} style={{ flexGrow: d.revenue[c] }} /> : null,
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {active !== null && active !== undefined && hover !== null ? (
            <div className="chart__tip" style={{ insetInlineStart: `${String(((hover + 0.5) / days.length) * 100)}%` }} data-flip={hover >= days.length / 2 || undefined}>
              <b>{dayLabel(active.day)}</b>
              {sites.map((c) => (
                <span key={c} className="chart__tip-row">
                  {sites.length > 1 ? <span className="chart__key" data-site={c} aria-hidden="true" /> : null}
                  <span>{sites.length > 1 ? fa[`channel.${c}`] : fa["dash.revenue"]}</span>
                  <b>
                    {formatToman(active.revenue[c])} {TOMAN}
                  </b>
                </span>
              ))}
              <span className="chart__tip-foot">{fa["dash.chart.orders"].replace("{n}", faInt(active.orders))}</span>
            </div>
          ) : null}
        </div>
        <div className="chart__x" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.day}>{i % 7 === 0 ? dayLabel(d.day) : ""}</span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>{fa["dash.chart.title"]}</caption>
        <thead>
          <tr>
            <th scope="col">{fa["dash.chart.day"]}</th>
            {sites.map((c) => (
              <th key={c} scope="col">
                {fa[`channel.${c}`]}
              </th>
            ))}
            <th scope="col">{fa["dash.orders"]}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((d) => (
            <tr key={d.day}>
              <th scope="row">{dayLabel(d.day)}</th>
              {sites.map((c) => (
                <td key={c}>
                  {formatToman(d.revenue[c])} {TOMAN}
                </td>
              ))}
              <td>{faInt(d.orders)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
