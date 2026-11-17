"use client";
import { useState } from "react";
import type { Quote } from "@namilux/core/client";
import { t } from "@/i18n";
import { Button } from "@/components/ui/Button";

export function CouponField({ value, onApply, applied, onRemove }: { value: string; onApply: (code: string) => void; applied: Quote["coupon"] | undefined; onRemove: () => void }): React.ReactNode {
  const [code, setCode] = useState(value);
  const isApplied = applied !== undefined && "code" in applied;
  const failed = applied !== undefined && "error" in applied;
  return (
    <div className="flex flex-col gap-1">
      <label className="t-body text-ink" htmlFor="coupon">{t("checkout.coupon")}</label>
      {isApplied ? (
        <div className="flex items-center justify-between gap-3 border border-accent p-3">
          <span className="t-body text-ink">{t("checkout.coupon.applied", { code: (applied as { code: string }).code })}</span>
          <button type="button" className="link-under t-caption" onClick={onRemove}>{t("checkout.coupon.remove")}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input id="coupon" className="line-input flex-1" value={code} onChange={(e) => setCode(e.target.value)} inputMode="text" autoComplete="off" />
          <Button variant="secondary" onClick={() => onApply(code)}>{t("checkout.coupon.apply")}</Button>
        </div>
      )}
      {failed ? <p className="t-caption text-danger">{t("checkout.error.generic")}</p> : null}
    </div>
  );
}
