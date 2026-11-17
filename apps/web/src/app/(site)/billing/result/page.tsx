import { noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import { ClearCartOnSuccess } from "@/components/checkout/ClearCartOnSuccess";
import { ResultBody } from "@/components/checkout/ResultBody";
import { t } from "@/i18n";

// Reads runtime data (session/searchParams), so it is never prerendered (cacheComponents).
export const instant = false;

export function generateMetadata(): Metadata {
  const meta = noindexMeta(t("result.ok.title"));
  return { title: meta.title, robots: meta.robots };
}

export default async function ResultRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<React.ReactNode> {
  const sp = await searchParams;
  const o = sp["o"];
  const code = typeof o === "string" ? o : "";
  const ok = sp["s"] === "ok";
  const pending = sp["s"] === "pending";
  return (
    <main className="wrap pt-6 pb-16 md:pt-10">
      {ok ? <ClearCartOnSuccess /> : null}
      <ResultBody pending={pending} ok={ok} code={code} test={false} whatsappHref="https://wa.me/989121230077" storeAddress="" canRetry={!ok && !pending} />
    </main>
  );
}
