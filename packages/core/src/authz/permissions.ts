import type { SalesChannel } from "../channel";
import type { RoleName } from "../constants";
import { appError } from "../errors";
import type { SettingsKey } from "../settings/schema";
import type { StaffUser } from "../types";

// DECISION (M0 step 3): RoleName is declared once in ../constants; authz re-exports the same
// declaration so ../auth/staff.ts can import it from here (its dependency list line).
export type { RoleName };

export const PERMISSIONS = [
  "catalog.read", "catalog.write", "catalog.price", "catalog.cost", "catalog.bulk", "media.write", "media.delete",
  "orders.read", "orders.write", "orders.refund", "orders.manual_payment", "orders.create",
  "customers.read", "customers.write", "customers.export", "customers.points",
  "inbox.read", "inbox.reply", "marketing.coupons", "marketing.banners", "marketing.sms", "marketing.loyalty",
  "content.write", "seo.write", "settings.read", "settings.write", "settings.money", "settings.security",
  "analytics.read", "staff.manage", "audit.read", "system.jobs", "system.cache",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * The four permissions that guard MONEY - the owner (head admin) holds them across both storefronts.
 *
 *   catalog.cost     the purchase price of a product, and therefore its margin
 *   settings.money   the settings groups that move money: VAT, the instalment commission and its
 *                    rounding step, and the loyalty rules (MONEY_SETTINGS_KEYS below)
 *   analytics.read   sales and revenue: the dashboard's revenue/AOV/conversion tiles, the top
 *                    products' revenue column and every screen under /analytics
 *   marketing.loyalty the loyalty *rules* editor, which is the loyalty.rules money group's own page
 *
 * A permission listed here appears in no role row but `owner`'s - except `analytics.read` in a
 * role confined to one storefront (ROLE_CHANNEL below), where every figure it can read is that
 * storefront's own and the other site's sales stay invisible. The tests assert both halves.
 */
export const MONEY_PERMISSIONS: readonly Permission[] = [
  "catalog.cost", "settings.money", "analytics.read", "marketing.loyalty",
];

/**
 * The settings groups `settings.money` guards. Everything else under /settings - store info,
 * contact, hours, social, shipping copy, seals, the promo bar, the PWA coach, SEO defaults, the
 * flags - is ordinary operational configuration an admin edits with settings.read/settings.write.
 *
 * `commerce.installments` carries the SnappPay commission and the rounding step, i.e. the arithmetic
 * that prices the second storefront; `commerce.vat_percent` is the tax added at checkout;
 * `loyalty.rules` is what a Toman of spend is worth in points. All three move money.
 */
export const MONEY_SETTINGS_KEYS: readonly SettingsKey[] = [
  "commerce.vat_percent", "commerce.installments", "loyalty.rules",
];

export function isMoneySettingsKey(key: string): boolean {
  return (MONEY_SETTINGS_KEYS as readonly string[]).includes(key);
}

const ALL = PERMISSIONS;
/** Everything an `admin` may NOT do - the owner-only column of the table below. */
const OWNER_ONLY: readonly Permission[] = [
  ...MONEY_PERMISSIONS,
  "settings.security", "staff.manage",
  "customers.export", // a bulk CSV of every shopper's phone and address leaves with the owner only
  "audit.read", "system.jobs", "system.cache", // the infrastructure screens under /system
];

/**
 * ── the permission matrix ────────────────────────────────────────────────────────────────────────
 *
 * area                                    │ owner │ admin │ instal.│ manager │ orders │ content │ support │ viewer
 * ────────────────────────────────────────┼───────┼───────┼────────┼─────────┼────────┼─────────┼─────────┼───────
 * products: read                          │   ✓   │   ✓   │   ✓¹   │    ✓    │   ✓    │    ✓    │    ✓    │   ✓
 * products: create/edit/media/variants    │   ✓   │   ✓   │   –    │    ✓    │   –    │    ✓    │    –    │   –
 * products: price + instalment price      │   ✓   │   ✓   │   –    │    ✓    │   –    │    –    │    –    │   –
 * products: COST PRICE and MARGIN         │   ✓   │   –   │   –    │    –    │   –    │    –    │    –    │   –
 * products: bulk price / FX / CSV import  │   ✓   │   ✓   │   –    │    ✓    │   –    │    –    │    –    │   –
 * categories · brands · collections · attrs│  ✓   │   ✓   │   –    │    ✓    │   –    │    ✓    │    –    │   –
 * media: upload / delete                  │   ✓   │   ✓   │   –    │    ✓    │   –    │  up.only│    –    │   –
 * orders: list · detail · transitions     │   ✓   │   ✓   │   ✓¹   │    ✓    │   ✓    │    –    │  read   │  read
 * orders: manual order · mark paid        │   ✓   │   ✓   │   –    │    ✓    │  part  │    –    │    –    │   –
 * orders: refund / returns                │   ✓   │   ✓   │   ✓¹   │    ✓    │   –    │    –    │    –    │   –
 * customers: read/write/points            │   ✓   │   ✓   │ read¹  │    ✓    │  read  │    –    │  r/w    │  read
 * customers: CSV export                   │   ✓   │   –   │   –    │    ✓    │   –    │    –    │    –    │   –
 * inbox · contact replies · reviews       │   ✓   │   ✓   │   –    │    ✓    │   ✓    │    –    │    ✓    │  read
 * marketing: coupons · banners · promo·SMS│   ✓   │   ✓   │   –    │    ✓    │   –    │ banners │    –    │   –
 * marketing: LOYALTY RULES                │   ✓   │   –   │   –    │    –    │   –    │    –    │    –    │   –
 * content: pages · posts · FAQ · menus    │   ✓   │   ✓   │   –    │    ✓    │   –    │    ✓    │    –    │   –
 * SEO: meta · redirects · 404s            │   ✓   │   ✓   │   –    │    ✓    │   –    │    ✓    │    –    │   –
 * settings: store/contact/hours/social/…  │   ✓   │   ✓   │   –    │    ✓    │   –    │    –    │    –    │  read
 * settings: MONEY (VAT · instalments)     │   ✓   │   –   │   –    │    –    │   –    │    –    │    –    │   –
 * settings: security                      │   ✓   │   –   │   –    │    –    │   –    │    –    │    –    │   –
 * ANALYTICS · sales and revenue reports   │   ✓   │   –   │   ✓¹   │    –    │   –    │    –    │    –    │   –
 * staff and roles                         │   ✓   │   –   │   –    │    –    │   –    │    –    │    –    │   –
 * audit log · security events             │   ✓   │   –   │   –    │    ✓    │   –    │    –    │    –    │   ✓
 * system: jobs · SMS log · cache · health │   ✓   │   –   │   –    │    ✓    │   –    │    –    │    –    │   –
 *
 * ¹ `instalments`: that storefront's records only - its orders, returns, customers and sales, and
 *   the products it may sell, read-only (ROLE_CHANNEL below).
 *
 * `owner` is the head admin: one account, the only one that sees money or touches staff.
 * `admin` is the everyday back-office role - everything operational, nothing financial.
 * `instalments` runs the instalment storefront and sees nothing of the main one.
 * `manager` is `admin` plus the read-only infrastructure screens and the customer export; it is
 * kept because older databases may still point a row at it, and it too holds no money permission.
 */
export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => !OWNER_ONLY.includes(p)),
  // The instalment site's own manager and accountant: its orders from placement to refund, the
  // customers who bought there, its sales figures, and the products it may sell - read-only, because
  // a product, its price and its stock are shared with the main site. ROLE_CHANNEL confines every
  // one of these to the instalment channel; nothing here is ever evaluated without that scope.
  instalments: ["catalog.read", "orders.read", "orders.write", "orders.refund", "customers.read", "analytics.read"],
  manager: ALL.filter((p) => !MONEY_PERMISSIONS.includes(p) && p !== "settings.security" && p !== "staff.manage"),
  orders: ["catalog.read", "orders.read", "orders.write", "orders.create", "customers.read", "inbox.read", "inbox.reply"],
  content: ["catalog.read", "catalog.write", "media.write", "marketing.banners", "content.write", "seo.write"],
  support: ["catalog.read", "orders.read", "customers.read", "customers.write", "inbox.read", "inbox.reply"],
  // DECISION (M0 tests): the spec row "staff.* / audit.read / system.*" gives viewer `-/checked/-`,
  // i.e. audit.read. The table is the DECIDED source this module cites, so the drifted list gains it.
  viewer: ["catalog.read", "orders.read", "customers.read", "inbox.read", "settings.read", "audit.read"],
};
export const SUDO_PERMISSIONS: readonly Permission[] = [
  "catalog.bulk", "orders.refund", "orders.manual_payment", "media.delete", "settings.write", "settings.security", "staff.manage", "customers.export",
];

// DECISION (M0 tests): the EDGE CASE asks for security.event("authz.unknown_role") on role drift,
// but `can` takes no Db handle and ../security is not in this module's dependency list. The check stays
// pure (unknown role -> no permissions); the staff auth service, which does hold a Db, records it.
export function can(user: Pick<StaffUser, "role" | "isActive">, p: Permission): boolean {
  if (!user.isActive) return false;
  return permissionsForRole(user.role).includes(p);
}

export function assertCan(user: Pick<StaffUser, "role" | "isActive">, p: Permission): void {
  if (!can(user, p)) throw appError("FORBIDDEN", { fa: "دسترسی ندارید" });
}
// DECISION (M0 tests): the row is read with hasOwnProperty, never with a bare index - a drifted role
// string such as "toString" or "__proto__" would otherwise resolve to an Object.prototype member and
// be treated as a permission list (the spec: unknown input is rejected, never coerced).
export function permissionsForRole(role: RoleName): readonly Permission[] {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role] : [];
}
export function requiresSudo(p: Permission): boolean { return SUDO_PERMISSIONS.includes(p); }

/**
 * ── storefront scope ─────────────────────────────────────────────────────────────────────────────
 *
 * A role listed here sees ONE storefront. Its permissions above say what it may do; this says on
 * which site's data: every order, return, customer and sales figure it reads or changes is that
 * channel's, and the products it sees are the ones that channel may sell. An unlisted role (owner,
 * admin, …) works across both sites. The admin enforces it on the server, per query and per record
 * (apps/admin/src/lib/scope.ts) - the menu hiding a link is a convenience, never the protection.
 */
export const ROLE_CHANNEL: Partial<Record<RoleName, SalesChannel>> = {
  instalments: "instalments",
};

/** The storefront a staff member is confined to, or null when they work across both. */
export function channelScope(user: Pick<StaffUser, "role">): SalesChannel | null {
  return Object.prototype.hasOwnProperty.call(ROLE_CHANNEL, user.role) ? (ROLE_CHANNEL[user.role] ?? null) : null;
}

/** True for a role name the code knows - a drifted DB row is neither trusted nor coerced. */
export function isRoleName(role: string): role is RoleName {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role);
}
