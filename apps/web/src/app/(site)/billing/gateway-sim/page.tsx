import { noindexMeta } from "@namilux/core";
import type { Metadata } from "next";
import { GatewaySim } from "@/components/checkout/GatewaySim";
import { t } from "@/i18n";

// Reads runtime data (session/searchParams), so it is never prerendered (cacheComponents).
export const instant = false;

export function generateMetadata(): Metadata {
  const meta = noindexMeta(t("result.test"));
  return { title: meta.title, robots: meta.robots };
}

export default async function GatewaySimRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<React.ReactNode> {
  const sp = await searchParams;
  const a = sp["authority"];
  const authority = typeof a === "string" ? a : "";
  return (
    <main className="container pt-6 pb-12">
      <GatewaySim authority={authority} callbackBase="/api/payment/callback/mock/" />
    </main>
  );
}
