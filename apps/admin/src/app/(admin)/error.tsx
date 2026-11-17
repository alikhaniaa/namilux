"use client";
import Link from "next/link";
import { Button } from "@/components/kit";
import { fa } from "@/i18n/fa";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): React.ReactNode {
  return (
    <div className="ui-card mx-auto grid max-w-lg justify-items-center gap-3 text-center" role="alert">
      <span className="ui-badge ui-badge--danger">{fa["error.badge"]}</span>
      <h1 className="text-lg font-semibold">{fa["error.title"]}</h1>
      <p className="text-sm text-ink-2">{fa["error.body"]}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>{fa["error.retry"]}</Button>
        <Link href="/" className="ui-btn ui-btn--outline">
          {fa["error.home"]}
        </Link>
      </div>
      {error.digest === undefined ? null : <p className="text-xs text-ink-3 ltr">{fa["error.ref"].replace("{ref}", error.digest)}</p>}
    </div>
  );
}
