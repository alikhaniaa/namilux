import { fa } from "@/i18n/fa";

export const methodLabel = (m: string | null): string =>
  m === null || m === "none" ? fa["pay.method.none"] : m === "zarinpal" || m === "snapppay" || m === "mock" || m === "manual" ? fa[`pay.method.${m}`] : m;

/** How an order was (or is being) paid, as a coloured chip: SnappPay always in the instalment colour. */
export function MethodChip({ method, large = false }: { method: string | null; large?: boolean }) {
  return (
    <span className={`pay-chip${large ? " pay-chip--lg" : ""}`} data-method={method ?? "none"}>
      {methodLabel(method)}
    </span>
  );
}

