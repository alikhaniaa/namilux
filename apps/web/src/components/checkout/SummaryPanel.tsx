import type { Quote, SealEmbed } from "@namilux/core/client";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { TrustSeals } from "./TrustSeals";

type Seal = SealEmbed | null;

export function SummaryPanel({ quote, seals }: { quote: Quote | null; seals: { enamad: Seal; samandehi: Seal } }): React.ReactNode {
  return (
    <div className="flex flex-col gap-4">
      <OrderSummary quote={quote} compact />
      <TrustSeals enamad={seals.enamad} samandehi={seals.samandehi} />
    </div>
  );
}
