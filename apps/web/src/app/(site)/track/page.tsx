import { noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import { connection } from "next/server";
import { TrackForm } from "@/components/account/TrackForm";
import { t } from "@/i18n";

export function generateMetadata(): Metadata {
  const meta = noindexMeta(t("track.title"));
  return { title: meta.title, robots: meta.robots };
}

/** Nonce CSP route (proxy.ts DYNAMIC_PREFIXES): render per request so the nonce in the markup is the one in the header - see account/layout.tsx (4 Sep 2026). */
export const instant = false;

export default async function TrackPage(): Promise<React.ReactNode> {
  await connection();
  return (
    <section className="wrap section grid gap-6">
      <header className="grid gap-2">
        <h1 className="d-2">{t("track.title")}</h1>
        <p className="t-body max-w-[52ch] text-ink-2">{t("track.body")}</p>
      </header>
      <TrackForm />
    </section>
  );
}
