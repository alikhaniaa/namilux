import { faInt } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

const LABEL: Record<string, string> = {
  pv: fa["analytics.step.pv"],
  pdp: fa["analytics.step.pdp"],
  atc: fa["analytics.step.atc"],
  checkout: fa["analytics.step.checkout"],
  checkout_step_1: fa["analytics.step.checkout_step_1"],
  checkout_step_2: fa["analytics.step.checkout_step_2"],
  checkout_step_3: fa["analytics.step.checkout_step_3"],
  purchase: fa["analytics.step.purchase"],
};

export function Funnel({ steps }: { steps: { step: string; count: number; rate: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <Card title={fa["analytics.funnel"]}>
      <ul className="bar-list">
        {steps.map((s) => (
          <li key={s.step} className="bar-list__row">
            <span className="bar-list__label">{LABEL[s.step] ?? s.step}</span>
            <span className="bar-list__track" aria-hidden="true">
              <span className="bar-list__bar" style={{ inlineSize: `${String(Math.round((s.count / max) * 100))}%` }} />
            </span>
            {/* two explicit cells: count and rate - the old "۷۶ · ٪۱۰۰" collapsed into one number under bidi */}
            <span className="bar-list__nums">
              <b>{faInt(s.count)}</b>
              <small>{faInt(Math.round(s.rate * 100))}٪</small>
            </span>
          </li>
        ))}
        {steps.length === 0 ? <li className="text-xs text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
      </ul>
    </Card>
  );
}
