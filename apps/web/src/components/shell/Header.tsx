import type { ShellNav } from "@/server/loaders/nav";
import Link from "next/link";
import { Suspense } from "react";
import { BackButton } from "./BackButton";
import { CartBadge } from "./CartBadge";
import { CompareControl } from "./CompareControl";
import { HeaderDesktopNav } from "./HeaderDesktopNav";
import { HeaderScroll } from "./HeaderScroll";
import { NavDrawer } from "./NavDrawer";
import { SearchOverlay } from "./SearchOverlay";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";
import { WishlistCount } from "./WishlistCount";
import { Icon } from "@/components/ui/Icon";
import { t } from "@/i18n";

/**
 * DECISION: this stays a server component, as the contract says, which means it cannot hold the
 * drawer's or the overlay's open state. So `NavDrawer` and `SearchOverlay` each render their own
 * trigger button next to their panel and own that state internally (their `open`/`onClose` props
 * remain, for a caller that wants to drive them). The alternative - making the header a client
 * component - would ship the whole graphite frame as JS for two buttons.
 *
 * DESIGN (owner verdict 6 Sep 2026: "the menu bar is a bit weird - like a random part inside a
 * premium website"). The header is now ONE graphite plane in two tiers divided by a --frame-line
 * hairline, never a detached band:
 *
 *   tier 1 (64 px)  the mark at the inline start · the shopper's own controls at the inline end
 *   tier 2 (48 px)  «دسته‌ها» + the header menu at the inline start · search at the inline end
 *
 * Both tiers share the `.wrap` gutters, so the two rows stand on the same two vertical axes and
 * read as one composed block - the composition the footer already uses (mark at the start, the
 * rest at the end). 64 + 48 = 112 px, unchanged, so `.hero-under-header` still lines up and the
 * scroll states stay purely tonal (no height change, no layout shift).
 *
 * The desktop «منو» trigger is gone: with the section nav, the categories panel and the footer all
 * present at desktop widths the drawer was a third parallel navigation, and it was half of what
 * made the two rows read as unrelated clusters. It remains the phone's menu.
 */
export function Header({ nav, isHome, megaNav = false, instagram = "" }: { nav: ShellNav; isHome: boolean; megaNav?: boolean; instagram?: string }): React.ReactNode {
  const headerMenu = nav.menus.header;
  const store = nav.footer.store;
  const contact = { whatsapp: store.whatsapp, phoneMobile: store.phoneMobile, phoneLand: store.phoneLand, hoursNote: store.hoursNote, instagram };

  return (
    <header className="frame site-header sticky top-0 z-40" data-site-header data-home={isHome ? "1" : undefined}>
      <Suspense fallback={null}>
        <HeaderScroll />
      </Suspense>

      {/* Phone - one row, 56 px, icons only, each with an aria-label. Shown and hidden by the
          media query on `.site-header__phone` in components.css, never by a Tailwind responsive
          display variant: that file is imported unlayered and last, so a recipe outranks the
          utility - the utility would lose and this row would leak on to the desktop. */}
      <div className="site-header__phone">
        <div className="wrap flex h-14 items-center justify-between gap-2 site-header__phone-row">
          <div className="flex items-center gap-1 site-header__phone-start">
            {/* In standalone on an inner page this replaces the burger; elsewhere it renders the burger.
                Both islands read the pathname, which `cacheComponents` counts as runtime data - an
                unwrapped one blocks the prerender of every page under this header. */}
            <Suspense fallback={<NavDrawer nav={nav} contact={contact} />}>
              <BackButton fallback={<NavDrawer nav={nav} contact={contact} />} />
            </Suspense>
            <Suspense fallback={<span className="block size-[40px]" aria-hidden="true" />}>
              <SearchOverlay brands={nav.brands} collections={nav.collections} />
            </Suspense>
          </div>
          <Wordmark size="sm" />
          <div className="flex items-center gap-1 site-header__phone-end">
            <Link href="/cart/" aria-label={t("shell.cart")} className="icon-btn">
              <Icon name="bag" size={24} />
              <CartBadge />
            </Link>
          </div>
        </div>
      </div>

      {/* Desktop tier 1 - the mark and the shopper's own controls. */}
      <div className="site-header__bar">
        <div className="wrap site-header__row">
          <Wordmark size="md" />
          <div className="site-header__tools">
            <Link href="/wishlist/" className="labelled-ctl">
              <Icon name="heart" size={20} />
              {t("shell.wishlist")}
              <WishlistCount />
            </Link>
            <CompareControl variant="header" />
            <Link href="/cart/" className="labelled-ctl">
              <Icon name="bag" size={20} />
              {t("shell.cart")}
              <CartBadge />
            </Link>
            <span className="site-header__sep" aria-hidden="true" />
            <Link href="/account/" aria-label={t("shell.account")} className="icon-btn">
              <Icon name="user" size={20} />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Desktop tier 2 - the section nav and the search field. */}
      <HeaderDesktopNav items={headerMenu} nav={nav} megaNav={megaNav} brands={nav.brands} collections={nav.collections} />
    </header>
  );
}
