import type { ReactNode } from "react";
import { can, channelScope } from "@namilux/core";
import type { Permission, StaffUser } from "@namilux/core";
import { AdminTabBar, type TabLink } from "./AdminTabBar";
import { FreshOnHistory } from "./FreshOnHistory";
import { Sidebar, type NavGroup } from "./Sidebar";
import { SudoDialog } from "./SudoDialog";
import { Topbar } from "./Topbar";
import { ToastHost } from "@/components/kit-client";
import { fa } from "@/i18n/fa";

/**
 * `site`: the link's screen is per storefront (its queries honour lib/scope.ts), so a staff member
 * confined to one site may open it. Every other screen serves both sites at once - the catalogue's
 * taxonomy, marketing, content, settings - and stays off a confined role's menu (and its page
 * guard, `requireBothSites`, 404s it).
 */
type Link = { href: string; label: string; perm: Permission; badge?: "inbox" | "jobsFailed"; site?: true };
type Group = { title: string; links: Link[] };

/**
 * the spec URL map, grouped as §14 describes.
 *
 * Every row carries the permission its PAGE asserts, so the sidebar and the server agree by
 * construction: an admin never sees a link to a screen `requirePermission` would bounce them off,
 * and the owner sees the lot. The link is a convenience, never the protection - see the page and
 * route guards.
 */
const GROUPS: Group[] = [
  {
    title: fa["nav.group.overview"],
    links: [{ href: "/", label: fa["nav.dashboard"], perm: "catalog.read", site: true }],
  },
  {
    title: fa["nav.orders"],
    links: [
      { href: "/orders", label: fa["nav.orders"], perm: "orders.read", site: true },
      { href: "/returns", label: fa["nav.returns"], perm: "orders.read", site: true },
      { href: "/customers", label: fa["nav.customers"], perm: "customers.read", site: true },
      { href: "/inbox", label: fa["nav.inbox"], perm: "inbox.read", badge: "inbox" },
      { href: "/reviews", label: fa["nav.reviews"], perm: "inbox.read" },
    ],
  },
  {
    title: fa["nav.products"],
    links: [
      { href: "/products", label: fa["nav.products"], perm: "catalog.read", site: true },
      { href: "/products/prices", label: fa["nav.prices"], perm: "catalog.price" },
      { href: "/categories", label: fa["nav.categories"], perm: "catalog.read" },
      { href: "/brands", label: fa["nav.brands"], perm: "catalog.read" },
      { href: "/collections", label: fa["nav.collections"], perm: "catalog.read" },
      { href: "/attributes", label: fa["nav.attributes"], perm: "catalog.read" },
      { href: "/media", label: fa["nav.media"], perm: "catalog.read" },
    ],
  },
  {
    title: fa["nav.marketing"],
    links: [
      { href: "/marketing/coupons", label: fa["nav.coupons"], perm: "marketing.coupons" },
      { href: "/marketing/banners", label: fa["nav.banners"], perm: "marketing.banners" },
      { href: "/marketing/promo", label: fa["nav.promo"], perm: "marketing.banners" },
      { href: "/marketing/sms", label: fa["nav.sms"], perm: "marketing.sms" },
      { href: "/marketing/ig", label: fa["nav.ig"], perm: "marketing.banners" },
      { href: "/marketing/loyalty", label: fa["nav.loyalty"], perm: "marketing.loyalty" },
      { href: "/analytics", label: fa["nav.analytics"], perm: "analytics.read" },
    ],
  },
  {
    title: fa["nav.content"],
    links: [
      { href: "/content/posts", label: fa["nav.posts"], perm: "content.write" },
      { href: "/content/pages", label: fa["nav.pages"], perm: "content.write" },
      { href: "/content/faq", label: fa["nav.faq"], perm: "content.write" },
      { href: "/content/menus", label: fa["nav.menus"], perm: "content.write" },
    ],
  },
  {
    title: fa["nav.seo"],
    links: [
      { href: "/seo", label: fa["nav.seo"], perm: "seo.write" },
      { href: "/seo/redirects", label: fa["nav.redirects"], perm: "seo.write" },
      { href: "/seo/404", label: fa["nav.notfound"], perm: "seo.write" },
    ],
  },
  {
    title: fa["nav.system"],
    links: [
      { href: "/settings", label: fa["nav.settings"], perm: "settings.read" },
      { href: "/settings/staff", label: fa["settings.staff"], perm: "staff.manage" },
      { href: "/settings/roles", label: fa["settings.roles"], perm: "staff.manage" },
      { href: "/system/jobs", label: fa["nav.jobs"], perm: "system.jobs", badge: "jobsFailed" },
      { href: "/system/sms-log", label: fa["nav.smsLog"], perm: "audit.read" },
      { href: "/system/security", label: fa["nav.security"], perm: "audit.read" },
      { href: "/system/cache", label: fa["nav.cache"], perm: "system.cache" },
      { href: "/system/health", label: fa["nav.health"], perm: "system.jobs" },
    ],
  },
];

export function AdminShell({
  staff,
  counts,
  children,
  storeOrigin,
}: {
  staff: StaffUser;
  counts: { inbox: number; jobsFailed: number };
  children: ReactNode;
  storeOrigin?: string;

}) {
  const scope = channelScope(staff);
  const groups: NavGroup[] = GROUPS.map((g) => ({
    title: g.title,
    links: g.links
      .filter((l) => can(staff, l.perm) && (scope === null || l.site === true))
      .map(({ href, label, badge }) => ({ href, label, ...(badge === undefined ? {} : { badge }) })),
  })).filter((g) => g.links.length > 0);

  // The phone bar carries the four daily screens the role may open; «منو» reaches the rest.
  const tabs: TabLink[] = [
    { href: "/", label: fa["tab.dashboard"] },
    ...(can(staff, "orders.read") ? [{ href: "/orders" as const, label: fa["tab.orders"] }] : []),
    ...(can(staff, "inbox.read") && scope === null ? [{ href: "/inbox" as const, label: fa["tab.inbox"], badge: counts.inbox }] : []),
    ...(can(staff, "catalog.read") ? [{ href: "/products" as const, label: fa["tab.products"] }] : []),
  ];

  // The storefronts this staff member works on, for the «مشاهدهٔ فروشگاه» links.
  const stores: { href: string; label: string; site: "main" | "instalments" }[] = [
    ...(scope !== "instalments" && storeOrigin !== undefined && storeOrigin !== "" ? [{ href: storeOrigin, label: fa["channel.main"], site: "main" as const }] : []),
  ];

  return (
    <div className="workspace-shell">
      <Sidebar groups={groups} counts={counts} stores={stores} scope={scope} />
      <div className="workspace-column">
        <Topbar
          staffName={staff.name}
          roleLabel={fa[`role.${staff.role}`] ?? staff.role}
          stores={stores}
          can={{
            products: can(staff, "catalog.read"),
            orders: can(staff, "orders.read"),
            customers: can(staff, "customers.read"),
            cache: can(staff, "system.cache"),
          }}
        />
        <main id="workspace-main" className="workspace-main">
          {children}
        </main>
        <AdminTabBar links={tabs} />
      </div>
      <SudoDialog />
      <ToastHost />
      <FreshOnHistory />
    </div>
  );
}
