import type { MenuItem, NavBrand, NavCollection, NavData } from "@namilux/core";
import Link from "next/link";
import { Suspense } from "react";
import { MegaNav } from "./MegaNav";
import { SearchOverlay } from "./SearchOverlay";
import { t } from "@/i18n";

/**
 * The header's second tier: «دسته‌ها» and the destinations the admin keeps in the `header` menu at
 * the inline start, the search field at the inline end. It is NOT a band of its own - no
 * background, no border of its own; the graphite comes from `.site-header` and the hairline that
 * divides the two tiers is drawn by the tier above it as an inset shadow, so this row costs
 * exactly its 48 px and the header's total height never moves.
 *
 * `.site-nav` is the positioned ancestor the categories panel resolves against, which is what lets
 * the panel span the full width and still align its columns to the page's `.wrap` gutters.
 */
export function HeaderDesktopNav({
  items,
  nav,
  megaNav = false,
  brands,
  collections,
}: {
  items: MenuItem[];
  nav?: NavData;
  megaNav?: boolean;
  brands: NavBrand[];
  collections: NavCollection[];
}): React.ReactNode {
  return (
    <div className="site-nav">
      <div className="wrap site-nav__row">
        <nav aria-label={t("a11y.mainNav")}>
          <ul className="site-nav__list">
            {/* «دسته‌ها» opens the MegaNav panel when the feature flag is on. */}
            {megaNav && nav !== undefined ? (
              <li>
                <MegaNav nav={nav} />
              </li>
            ) : null}
            {items.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="nav-link">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Suspense fallback={<span className="site-search-cue" aria-hidden="true" />}>
          <SearchOverlay brands={brands} collections={collections} variant="bar" />
        </Suspense>
      </div>
    </div>
  );
}
