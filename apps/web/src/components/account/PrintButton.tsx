"use client";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

export function PrintButton(): React.ReactNode {
  return (
    <div className="invoice-print__actions">
      <Button variant="secondary" onClick={() => window.print()}>
        {t("invoice.print")}
      </Button>
    </div>
  );
}
