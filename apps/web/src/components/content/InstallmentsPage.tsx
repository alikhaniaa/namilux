import type { InstallmentsSetting, PageView } from "@namilux/core/client";
import { PageBody } from "./PageBody";

/**
 * DECISION: only the legacy terms body renders. The calculator needs (1) an amount to divide - 
 * `commerce.installments` carries months/fee/minAmount but no price, so on this page the number
 * has to be typed, which makes it a `"use client"` island, and a module is either client or
 * server, never both (this file must stay a server component to reach `RichHtml`); and (2) copy
 * keys that `apps/web/src/i18n/fa.ts` does not have. Printing «ماهی … تومان» against an invented
 * base amount would be a promise the store never made (the spec is OPEN(owner)), so the page
 * shows what is decided and nothing more. Reported: needs
 * `apps/web/src/components/content/InstallmentsCalculator.tsx` + `page.installments.*` keys.
 */
export function InstallmentsPage({ page }: { page: PageView; installments: InstallmentsSetting }): React.ReactNode {
  return <PageBody page={page} />;
}
