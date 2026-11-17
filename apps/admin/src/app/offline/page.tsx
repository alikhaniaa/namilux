import type { Metadata } from "next";
import { OfflineRetry } from "@/components/shell/OfflineRetry";
import { fa } from "@/i18n/fa";

export const metadata: Metadata = { title: fa["offline.title"], robots: { index: false, follow: false } };

export default function OfflinePage(): React.ReactNode {
  return (
    <main className="auth-pane min-h-dvh">
      <div className="auth-card text-center">
        <span className="brand-logo mx-auto" role="img" aria-label={fa["app.name"]} />
        <h1>{fa["offline.title"]}</h1>
        <p className="auth-card__lead">{fa["offline.body"]}</p>
        <OfflineRetry />
      </div>
    </main>
  );
}
