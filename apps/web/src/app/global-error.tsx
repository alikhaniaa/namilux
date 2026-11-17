"use client";
import { fa } from "@/i18n/fa";
import "../styles/globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  return (
    <html lang="fa-IR" dir="rtl">
      <body>
        <main className="wrap chapter grid min-h-dvh content-center justify-items-center gap-5 text-center">
          <span className="notfound-ghost" aria-hidden="true">
            ۵۰۰
          </span>
          <h1 className="d-1">{fa["error.title"]}</h1>
          <p className="t-lead max-w-[46ch] text-ink-2">{fa["error.body"]}</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button type="button" className="btn btn--primary" onClick={reset}>
              {fa["error.retry"]}
            </button>
            <a href="/" className="link-under t-sm">
              {fa["notFound.cta"]}
            </a>
          </div>
          {error.digest === undefined ? null : (
            <p className="t-xs text-ink-3">
              {fa["error.ref"]} <bdi className="tnum">{error.digest}</bdi>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
