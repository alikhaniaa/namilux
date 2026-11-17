import type { CustomerTimelineStep } from "@namilux/core";
import { formatJalali } from "@namilux/core/client";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

const NEGATIVE: ReadonlySet<CustomerTimelineStep["key"]> = new Set(["cancelled", "refunded", "returned"]);

export function OrderTimeline({ steps }: { steps: CustomerTimelineStep[] }): React.ReactNode {
  // The current step is the last done one; everything after it is still to come.
  let currentIdx = -1;
  steps.forEach((s, i) => {
    if (s.done) currentIdx = i;
  });
  return (
    <ol className="grid gap-4">
      {steps.map((s, i) => {
        const current = i === currentIdx;
        const tone = !s.done ? "border-line-2 text-ink-3" : NEGATIVE.has(s.key) ? "border-danger text-danger" : "border-ok text-ok";
        return (
          <li key={s.key} className={`flex gap-3 ${current ? "border-t-2 border-accent pt-3" : ""}`} aria-current={current ? "step" : undefined}>
            {/* A state dot is one of the two places a pill radius is allowed. */}
            <span className={`mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border ${tone}`} aria-hidden="true">
              {s.done ? <Icon name="check" size={16} /> : null}
            </span>
            <div className="grid min-w-0 gap-0.5">
              <p className={`t-sm ${s.done ? "font-semibold text-ink" : "text-ink-3"}`}>{s.label}</p>
              {s.at !== null ? <p className="t-xs text-ink-3">{formatJalali(s.at, "long")}</p> : null}
              {s.tracking !== undefined && s.tracking.code !== null ? (
                <p className="t-xs text-ink-2">
                  {t("order.tracking")}: <bdi dir="ltr">{s.tracking.code}</bdi>
                  {s.tracking.url !== null ? (
                    <a className="link-under ms-3" href={s.tracking.url} target="_blank" rel="noreferrer">
                      {t("order.tracking.link")}
                    </a>
                  ) : null}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
