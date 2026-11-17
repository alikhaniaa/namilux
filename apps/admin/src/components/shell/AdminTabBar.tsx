"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { faInt } from "@namilux/core/client";
import { Inbox, LayoutDashboard, Menu, Package, ShoppingBag, type LucideIcon } from "lucide-react";
import { SIDEBAR_EVENT } from "./Sidebar";
import { fa } from "@/i18n/fa";

export type TabHref = "/" | "/orders" | "/inbox" | "/products";
export type TabLink = { href: TabHref; label: string; badge?: number };

const ICONS: Record<TabHref, LucideIcon> = { "/": LayoutDashboard, "/orders": ShoppingBag, "/inbox": Inbox, "/products": Package };

function isActive(pathname: string, href: TabHref): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTabBar({ links }: { links: TabLink[] }): React.ReactNode {
  const pathname = usePathname();
  return (
    <>
      <nav className="workspace-tabbar" aria-label={fa["shell.menu"]}>
        {links.map((l) => {
          const Icon = ICONS[l.href];
          return (
            <Link key={l.href} href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined}>
              <span className="workspace-tabbar__icon">
                <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <span>{l.label}</span>
              {l.badge !== undefined && l.badge > 0 ? <span className="workspace-tabbar__badge">{faInt(l.badge)}</span> : null}
            </Link>
          );
        })}
        <button type="button" onClick={() => window.dispatchEvent(new Event(SIDEBAR_EVENT))}>
          <span className="workspace-tabbar__icon">
            <Menu size={22} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>{fa["tab.menu"]}</span>
        </button>
      </nav>
      <div className="workspace-tabbar-spacer" aria-hidden="true" />
    </>
  );
}
