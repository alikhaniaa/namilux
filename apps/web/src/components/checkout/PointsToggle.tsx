"use client";
import { faInt, formatToman } from "@namilux/core/client";
import type { Quote } from "@namilux/core/client";
import { t } from "@/i18n";

export function PointsToggle({ points, checked, onChange }: { points: Quote["points"] | undefined; checked: boolean; onChange: (v: boolean) => void }): React.ReactNode {
  if (points === undefined || points.available <= 0) return null;
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col gap-1">
        <span className="t-body text-ink">{checked && points.used > 0
          ? t("checkout.points.use", { points: faInt(points.used), amount: formatToman(points.value) })
          : t("checkout.points.available", { points: faInt(points.available) })}</span>
        {checked && points.used === 0 ? <span className="t-caption text-ink-2">{t("checkout.points.unavailable")}</span> : null}
      </span>
    </label>
  );
}
