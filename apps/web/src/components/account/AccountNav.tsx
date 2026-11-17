"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { faInt } from "@namilux/core/client";
import { Icon } from "@/components/ui/Icon";
import type { IconName } from "@/components/ui/Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

type AccountItem = { href: string; label: FaKey; hint: FaKey; icon: IconName };
const OVERVIEW: AccountItem = { href: "/account/", label: "account.overview", hint: "account.overview.hint", icon: "home" };
const ITEMS: AccountItem[] = [
  OVERVIEW,
  { href: "/account/orders/", label: "account.orders", hint: "account.orders.hint", icon: "bag" },
  { href: "/account/addresses/", label: "account.addresses", hint: "account.addresses.hint", icon: "location" },
  { href: "/account/wishlist/", label: "account.wishlist", hint: "account.wishlist.hint", icon: "heart" },
  { href: "/account/club/", label: "account.club", hint: "account.club.hint", icon: "star" },
  { href: "/account/requests/", label: "account.requests", hint: "account.requests.hint", icon: "chat" },
  { href: "/account/profile/", label: "account.profile", hint: "account.profile.hint", icon: "user" },
];

function selected(pathname: string): typeof ITEMS[number] {
  return ITEMS.slice(1).find((item) => `${pathname.replace(/\/$/, "")}/`.startsWith(item.href)) ?? OVERVIEW;
}

export function AccountNav({ counts }: { counts?: { orders?: number } }): React.ReactNode {
  const active = selected(usePathname());
  return (
    <nav className="account-nav" aria-label={t("account.title")}>
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} className="account-nav__item" aria-current={active.href === item.href ? "page" : undefined}>
          <Icon name={item.icon} size={20} />
          <span>{t(item.label)}</span>
          {item.href === "/account/orders/" && counts?.orders !== undefined ? <span className="account-nav__count">{faInt(counts.orders)}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function AccountHeading(): React.ReactNode {
  const item = selected(usePathname());
  return <header className="account-heading"><h1>{t(item.label)}</h1><p>{t(item.hint)}</p></header>;
}
