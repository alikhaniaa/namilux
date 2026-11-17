"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type PricingTab = { href: string; label: string };

/** The pricing section's own navigation: one screen per way of changing a price. */
export function PricingTabs({ tabs }: { tabs: PricingTab[] }) {
  const pathname = usePathname();
  return (
    <nav className="ui-tabs" aria-label="بخش‌های قیمت‌گذاری">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="ui-tab" aria-current={pathname === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
