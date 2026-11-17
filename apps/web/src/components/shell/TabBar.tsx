"use client";
import { faInt } from "@namilux/core/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/components/state/cart-store";
import { useWishlist } from "@/components/state/wishlist-store";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

const TABS: { href: string; key: FaKey; icon: IconName }[] = [
  { href: "/", key: "tab.home", icon: "home" },
  { href: "/shop/", key: "tab.shop", icon: "shop" },
  { href: "/wishlist/", key: "tab.wishlist", icon: "heart" },
  { href: "/cart/", key: "tab.cart", icon: "bag" },
];

/** The sticky buy bar and the checkout own the bottom edge on these routes. */
function isHidden(pathname: string): boolean {
  if (pathname.startsWith("/product/") || pathname.startsWith("/billing/")) return true;
  return /^\/account\/.+\/edit\/?$/.test(pathname);
}

/**
 * The dock slides away while the reader scrolls down and comes back on the first upward move, near
 * the top and at the very bottom (where the footer links live). Scroll events are coalesced per frame.
 */
function useDockAway(): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - last;
        const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 96;
        if (y < 80 || nearBottom) setAway(false);
        else if (delta > 8) setAway(true);
        else if (delta < -8) setAway(false);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);
  return away;
}

export function TabBar(): React.ReactNode {
  const pathname = usePathname();
  const away = useDockAway();
  const { count: cartCount } = useCart();
  const { count: wishCount } = useWishlist();

  if (isHidden(pathname)) return null;

  const countFor = (href: string): number | null =>
    href === "/cart/" ? cartCount : href === "/wishlist/" ? wishCount : null;

  return (
    <>
      <nav aria-label={t("a11y.mainNav")} className={`dock md:hidden${away ? " dock--away" : ""}`}>
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const count = countFor(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              aria-label={t(tab.key)}
              className={`dock__tab${active ? " is-active" : ""}`}
            >
              <span className="dock__icon">
                <Icon name={tab.icon} size={24} />
                {count === null || count === 0 ? null : (
                  <>
                    <span className="count-pill" aria-hidden="true">
                      {faInt(count)}
                    </span>
                    {/* The pill alone announces «۳»; the live region carries the whole sentence. */}
                    <span className="sr-only" aria-live="polite">
                      {t(tab.href === "/cart/" ? "a11y.cartCount" : "a11y.wishlistCount", { n: count })}
                    </span>
                  </>
                )}
              </span>
              {/* Every destination keeps its visible name, including inactive tabs. */}
              <span className="dock__label" aria-hidden="true">
                {t(tab.key)}
              </span>
            </Link>
          );
        })}
      </nav>
      {/* Spacer so the footer and the last section clear the floating dock. */}
      <div className="dock-spacer md:hidden" aria-hidden="true" />
    </>
  );
}
