"use client";
import Link from "next/link";
import { Wordmark } from "@/components/shell/Wordmark";
import { Button } from "@/components/ui/Button";
import { t } from "@/i18n";

// The message never reaches the page; the digest is the key the server log carries.
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  return (
    <div className="wrap chapter grid content-center justify-items-center gap-5 text-center">
      <Wordmark size="md" />
      <span className="notfound-ghost" aria-hidden="true">
        ۵۰۰
      </span>
      <h1 className="d-1">{t("error.title")}</h1>
      <p className="t-lead max-w-[46ch] text-ink-2">{t("error.body")}</p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button variant="primary" arrow onClick={reset}>
          {t("error.retry")}
        </Button>
        <Link href="/" className="link-under t-sm">
          {t("notFound.cta")}
        </Link>
      </div>
      {error.digest === undefined ? null : (
        <p className="t-xs text-ink-3">
          {t("error.ref")} <bdi className="tnum">{error.digest}</bdi>
        </p>
      )}
    </div>
  );
}
