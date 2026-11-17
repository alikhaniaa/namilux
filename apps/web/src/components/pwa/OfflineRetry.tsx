"use client";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

export function OfflineRetry(): React.ReactNode {
  return (
    <Button variant="primary" onClick={() => location.reload()}>
      {t("offline.retry")}
    </Button>
  );
}
