import { faInt } from "@namilux/core";
import type { UaClass } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

const UA_LABEL: Record<UaClass, string> = {
  mobile: fa["analytics.ua.mobile"],
  desktop: fa["analytics.ua.desktop"],
  inapp: fa["analytics.ua.inapp"],
  pwa: fa["analytics.ua.pwa"],
};

export function Sources({ sources, devices }: { sources: { source: string; sessions: number; purchases: number }[]; devices: Record<UaClass, number> }) {
  const total = Object.values(devices).reduce((a, b) => a + b, 0);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title={fa["analytics.sources"]}>
        <table className="w-full text-sm">
          <thead className="text-xs text-[var(--ink-2)]">
            <tr>
              <th className="p-1 text-start">{fa["analytics.sources"]}</th>
              <th className="p-1 text-start">{fa["dash.sessions"]}</th>
              <th className="p-1 text-start">{fa["analytics.purchases"]}</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source} className="border-t border-[var(--line)]">
                <td className="p-1 text-xs">{s.source === "direct" ? "ورود مستقیم" : <bdi>{s.source}</bdi>}</td>
                <td className="p-1 tabular-nums">{faInt(s.sessions)}</td>
                <td className="p-1 tabular-nums">{faInt(s.purchases)}</td>
              </tr>
            ))}
            {sources.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-2 text-xs text-[var(--ink-2)]">
                  {fa["table.empty"]}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
      <Card title={fa["analytics.devices"]}>
        <ul className="bar-list">
          {(Object.keys(UA_LABEL) as UaClass[]).map((k) => {
            const n = devices[k] ?? 0;
            return (
              <li key={k} className="bar-list__row">
                <span className="bar-list__label">{UA_LABEL[k]}</span>
                <span className="bar-list__track" aria-hidden="true">
                  <span className="bar-list__bar" style={{ inlineSize: `${String(total === 0 ? 0 : Math.round((n / total) * 100))}%` }} />
                </span>
                <span className="bar-list__nums">
                  <b>{faInt(n)}</b>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
