import Link from "next/link";
import { fa } from "@/i18n/fa";

export default function NotFound(): React.ReactNode {
  return (
    <main className="auth-pane min-h-dvh">
      <div className="auth-card text-center">
        <span className="brand-logo brand-logo--ink mx-auto" role="img" aria-label={fa["app.name"]} />
        <p className="text-4xl font-bold text-ink-3" aria-hidden="true">
          ۴۰۴
        </p>
        <h1>{fa["missing.title"]}</h1>
        <p className="auth-card__lead">{fa["missing.body"]}</p>
        <Link href="/" className="ui-btn ui-btn--default">
          {fa["error.home"]}
        </Link>
      </div>
    </main>
  );
}
