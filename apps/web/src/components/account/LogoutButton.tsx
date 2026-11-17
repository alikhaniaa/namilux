"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

export function LogoutButton(): React.ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout/", { method: "POST" });
        } finally {
          router.replace("/");
          router.refresh();
        }
      }}
    >
      {t("account.logout")}
    </Button>
  );
}
