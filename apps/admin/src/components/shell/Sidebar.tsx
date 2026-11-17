"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { faInt } from "@namilux/core/client";
import type { SalesChannel } from "@namilux/core/client";
import { fa } from "@/i18n/fa";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Activity,
  BarChart3,
  BookOpen,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Inbox,
  Instagram,
  LayoutDashboard,
  Layers,
  Link2,
  ListTree,
  Megaphone,
  MessageSquareText,
  Package,
  Percent,
  RefreshCw,
  Search,
  Settings,
  Shapes,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Tags,
  TriangleAlert,
  Undo2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/products": Package,
  "/products/prices": Tag,
  "/categories": Shapes,
  "/brands": Tags,
  "/collections": Layers,
  "/attributes": SlidersHorizontal,
  "/media": ImageIcon,
  "/orders": ShoppingBag,
  "/returns": Undo2,
  "/customers": Users,
  "/inbox": Inbox,
  "/reviews": Star,
  "/marketing/coupons": Percent,
  "/marketing/banners": ImageIcon,
  "/marketing/promo": Megaphone,
  "/marketing/sms": MessageSquareText,
  "/marketing/loyalty": Sparkles,
  "/marketing/ig": Instagram,
  "/analytics": BarChart3,
  "/content/posts": BookOpen,
  "/content/pages": FileText,
  "/content/faq": MessageSquareText,
  "/content/menus": ListTree,
  "/seo": Search,
  "/seo/redirects": Link2,
  "/seo/404": TriangleAlert,
  "/settings": Settings,
  "/settings/staff": Users,
  "/settings/roles": ShieldCheck,
  "/system/jobs": RefreshCw,
  "/system/sms-log": MessageSquareText,
  "/system/security": ShieldCheck,
  "/system/cache": RefreshCw,
  "/system/health": Activity,
  "/account": UserRound,
};

export type NavGroup = { title: string; links: { href: string; label: string; badge?: "inbox" | "jobsFailed" }[] };
export const SIDEBAR_EVENT = "nl:sidebar";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/products" && pathname.startsWith("/products/prices")) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  groups,
  counts,
  stores,
  scope,
}: {
  groups: NavGroup[];
  counts: { inbox: number; jobsFailed: number };
  stores: { href: string; label: string; site: SalesChannel }[];
  scope: SalesChannel | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = (): void => setOpen((v) => !v);
    window.addEventListener(SIDEBAR_EVENT, toggle);
    return () => window.removeEventListener(SIDEBAR_EVENT, toggle);
  }, []);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnResize = (): void => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  return (
    <>
      {open ? <button type="button" className="workspace-sidebar-scrim lg:hidden" aria-label={fa["common.close"]} onClick={() => setOpen(false)} /> : null}
      <aside className={cn("workspace-sidebar", open && "is-open")}>
        <div className="workspace-sidebar__brand">
          {/* the wordmark is drawn for the graphite frame; on the light sidebar it is painted in ink */}
          <Link href="/" aria-label={fa["app.name"]} className="brand-logo brand-logo--ink" />
          <button className="lg:hidden" type="button" aria-label={fa["common.close"]} onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </div>
        {/* Which panel this is: the whole shop, or - for a role confined to one - that storefront. */}
        <div className="workspace-sidebar__caption">
          <span className="workspace-sidebar__mark" data-site={scope ?? undefined} aria-hidden="true">
            N
          </span>
          <span className="min-w-0">
            {scope === null ? fa["shell.workspace"] : fa["scope.panel"]}
            <small>{scope === "instalments" ? "بایگانی سفارش‌های قدیمی" : "namilux.ir"}</small>
          </span>
        </div>
        <nav className="workspace-nav" aria-label={fa["shell.menu"]}>
          {groups.map((group) => (
            <details key={`${group.title}:${pathname}`} className="workspace-nav__section" open={group.links.some((l) => isActive(pathname, l.href)) || groups.indexOf(group) < 2}>
              <summary className="workspace-nav__group">{group.title}<ChevronDown size={14} aria-hidden="true" /></summary>
              <ul>
                {group.links.map((l) => {
                  const badge = l.badge === undefined ? 0 : counts[l.badge];
                  const NavIcon = NAV_ICONS[l.href] ?? FileText;
                  return (
                    <li key={l.href}>
                      <Link href={l.href} aria-current={isActive(pathname, l.href) ? "page" : undefined} className="workspace-nav__link">
                        <NavIcon size={18} strokeWidth={1.75} aria-hidden="true" />
                        <span>{l.label}</span>
                        {badge > 0 ? <span className={cn("workspace-nav__badge", l.badge === "jobsFailed" && "workspace-nav__badge--danger")}>{faInt(badge)}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </nav>
        {stores.length > 0 ? (
          <div className="workspace-sidebar__foot">
            {stores.map((s) => (
              <a key={s.site} href={s.href} target="_blank" rel="noopener noreferrer">
                <span className="site-dot" data-site={s.site} aria-hidden="true" />
                <span className="grow">
                  {fa["shell.viewStore"]} {s.label}
                </span>
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ))}
          </div>
        ) : null}
      </aside>
    </>
  );
}
