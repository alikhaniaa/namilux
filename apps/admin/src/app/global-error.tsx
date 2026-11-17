"use client";
import { fa } from "@/i18n/fa";
import "../styles/globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  return (
    <html lang="fa-IR" dir="rtl">
      <body>
        <main className="auth-pane min-h-dvh">
          <div className="auth-card text-center" role="alert">
            <span className="ui-badge ui-badge--danger justify-self-center">{fa["error.badge"]}</span>
            <h1>{fa["error.title"]}</h1>
            <p className="auth-card__lead">{fa["error.body"]}</p>
            <button type="button" className="ui-btn ui-btn--default" onClick={reset}>
              {fa["error.retry"]}
            </button>
            {error.digest === undefined ? null : <p className="text-xs text-ink-3 ltr">{fa["error.ref"].replace("{ref}", error.digest)}</p>}
          </div>
        </main>
      </body>
    </html>
  );
}
