import Link from "next/link";
import { Wordmark } from "@/components/shell/Wordmark";
import { t } from "@/i18n";

/**
 * DECISION: the 404 does NOT call `recordNotFound` here. `app/not-found.tsx` is rendered for every
 * miss including bot noise, it has no access to the request path or referrer without making the
 * whole route dynamic, and a write on a cached render would be a per-request side effect. The 404
 * monitor is fed from `content/redirects.recordNotFound`, which the root catch-all
 * calls with the decoded path it already resolved - the one place that knows what was asked for.
 */
export default function NotFound() {
  return (
    <div className="wrap chapter grid content-center justify-items-center gap-5 text-center">
      <Wordmark size="md" onLight />
      <span className="notfound-ghost" aria-hidden="true">۴۰۴</span>
      <h1 className="d-1">{t("notFound.title")}</h1>
      <p className="t-lead max-w-[46ch] text-ink-2">{t("notFound.body")}</p>
      <Link href="/" className="btn btn--primary">
        {t("notFound.cta")}
      </Link>
      <Link href="/shop/" className="link-under t-sm">
        {t("nav.shop")}
      </Link>
    </div>
  );
}
