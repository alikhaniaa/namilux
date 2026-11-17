"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { goBack, isStandalone } from "@/components/pwa/standalone";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

export function BackButton({ fallback = null }: { fallback?: React.ReactNode }): React.ReactNode {
  const pathname = usePathname();
  // Detected after mount: the server cannot know the display mode, and rendering the arrow
  // optimistically would put a dead control in the header of every browser visit.
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    setStandalone(isStandalone());
  }, []);

  if (!standalone || pathname === "/") return fallback;
  return (
    <button type="button" aria-label={t("shell.back")} onClick={() => goBack("/")} className="icon-btn">
      <Icon name="back" size={24} />
    </button>
  );
}
