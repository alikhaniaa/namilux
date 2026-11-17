import type { ReactNode } from "react";
import { can, countFxProducts } from "@namilux/core";
import { PageHeader } from "@/components/kit";
import { PricingTabs } from "@/components/pricing/PricingTabs";
import type { PricingTab } from "@/components/pricing/PricingTabs";
import { fa } from "@/i18n/fa";
import { requirePermission } from "@/lib/authz";
import { db } from "@/lib/db";

/**
 * Everything that changes a price lives under this one roof, a tab each: by hand, by a formula, from
 * a list, by an exchange rate - and the log of what was changed. The first tab is the one the shop
 * opens every day, so the section lands on it.
 */
export default async function PricesLayout({ children }: { children: ReactNode }) {
  const staff = await requirePermission("catalog.price");
  const bulk = can(staff, "catalog.bulk");
  // The exchange-rate tab is for shops that price some products in a foreign currency; with none,
  // it would be a screen that can never do anything.
  const fx = bulk ? await countFxProducts(db) : 0;
  const tabs: PricingTab[] = [
    { href: "/products/prices", label: fa["prices.tab.quick"] },
    ...(bulk ? [{ href: "/products/prices/group", label: fa["prices.tab.group"] }, { href: "/products/prices/paste", label: fa["prices.tab.paste"] }] : []),
    ...(fx > 0 ? [{ href: "/products/prices/fx", label: fa["prices.tab.fx"] }] : []),
    { href: "/products/prices/history", label: fa["prices.tab.history"] },
  ];
  return (
    <div className="price-hub">
      <PageHeader title={fa["nav.prices"]} />
      <PricingTabs tabs={tabs} />
      {children}
    </div>
  );
}
