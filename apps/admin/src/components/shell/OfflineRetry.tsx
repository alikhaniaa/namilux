"use client";
import { Button } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function OfflineRetry(): React.ReactNode {
  return (
    <Button
      onClick={() => {
        location.reload();
      }}
    >
      {fa["offline.retry"]}
    </Button>
  );
}
