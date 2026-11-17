import { faInt } from "@namilux/core/client";
import { t } from "@/i18n";

const STEPS = [1, 2, 3] as const;
const LABELS = ["checkout.step.1", "checkout.step.2", "checkout.step.3"] as const;

export function CheckoutStepper({ current }: { current: 1 | 2 | 3 }): React.ReactNode {
  return (
    <ol className="wizard mb-6">
      {STEPS.map((n, i) => {
        const done = n < current;
        const active = n === current;
        const state = active ? "active" : done ? "done" : "todo";
        return (
          <li key={n} className="contents" {...(active ? { "aria-current": "step" as const } : {})}>
            <span className="wizard__step" data-state={state}>
              <span className="wizard__dot tnum">{faInt(n)}</span>
              <span className={active ? "t-body text-ink" : "wizard__label--muted t-caption text-ink-2"}>{t(LABELS[i] ?? "checkout.step.1")}</span>
            </span>
            {n < 3 ? <span className="wizard__bar" {...(done ? { "data-done": "" } : {})} aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
