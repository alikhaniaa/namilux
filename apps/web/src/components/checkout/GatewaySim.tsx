"use client";
import { t } from "@/i18n";
import { Button } from "@/components/ui/Button";

export function GatewaySim({ authority, callbackBase }: { authority: string; callbackBase: string }): React.ReactNode {
  // DECISION: the two button labels are inline Persian - this is a dev/e2e-only simulator (never
  // shipped to production, refused by the driver registry when APP_ENV=prod), not storefront copy.
  const go = (status: "OK" | "NOK"): void => {
    window.location.assign(`${callbackBase}?Authority=${encodeURIComponent(authority)}&Status=${status}`);
  };
  return (
    <div className="flex flex-col items-center gap-4 text-center pt-10">
      <p className="t-caption text-accent">{t("result.test")}</p>
      <div className="flex gap-3">
        <Button variant="primary" onClick={() => go("OK")}>پرداخت موفق</Button>
        <Button variant="quiet" onClick={() => go("NOK")}>انصراف</Button>
      </div>
    </div>
  );
}
