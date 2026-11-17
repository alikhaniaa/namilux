import type { Metadata } from "next";
import { OfflineRetry } from "@/components/pwa/OfflineRetry";
import { Wordmark } from "@/components/shell/Wordmark";
import { t } from "@/i18n";

// Nothing is fetched here: the service worker serves this page precisely when the network is gone,
// so any loader would turn the fallback into a second failure.
export const metadata: Metadata = { title: t("offline.title"), robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main id="main" tabIndex={-1} className="wrap chapter grid min-h-dvh content-center justify-items-center gap-5 text-center">
      <Wordmark size="md" onLight />
      <h1 className="d-2">{t("offline.title")}</h1>
      <p className="t-lead text-ink-2">{t("offline.body")}</p>
      <OfflineRetry />
    </main>
  );
}
