import { randomBytes } from "node:crypto";
import { hashPassword } from "@namilux/core";
import { ROLE_PERMISSIONS, type Permission, type RoleName } from "@namilux/core/authz";
import { MENU_KEYS, type MenuKey } from "@namilux/core/constants";
import { ETA_DAYS } from "@namilux/core/geo";
import { ulid } from "@namilux/core/ids";
import { DEFAULT_SETTINGS, SETTINGS_KEYS } from "@namilux/core/settings";
import {
  eq,
  inArray,
  menus as menusTable,
  pages as pagesTable,
  settings as settingsTable,
  shippingMethods as shippingMethodsTable,
  staffRoles as staffRolesTable,
  staffUsers as staffUsersTable,
  sql,
  type MenuItem,
  type PageTemplate,
  type ShippingKind,
  type ShippingRate,
} from "@namilux/db";
import type { SeedContext } from "../context.js";
import { warn } from "../report.js";

export type ShippingMethodSeed = {
  key: string;
  name: string;
  description: string | null;
  kind: ShippingKind;
  rateJson: ShippingRate;
  provinces: string[] | null;
  etaMinDays: number;
  etaMaxDays: number;
  isActive: boolean;
  sort: number;
};

/**
 * the spec `free_nationwide` carries the whole zone band (Tehran 1–3 … far 4–7) because the table has
 * one scalar min/max pair; `etaForProvince` refines it per province from core `ETA_DAYS`.
 * DECISION: express_tehran keeps `flat: 0` - its price is OPEN(owner) and the seed never invents
 * money; it ships inactive so a 0-Toman express option can never be selected at checkout.
 */
export const SHIPPING_METHODS: ShippingMethodSeed[] = [
  {
    key: "free_nationwide",
    name: "ارسال رایگان به سراسر ایران",
    description: "زمان ارسال بسته به استان ۱ تا ۷ روز کاری",
    kind: "free",
    rateJson: {},
    provinces: null,
    etaMinDays: ETA_DAYS.tehran.min,
    etaMaxDays: ETA_DAYS.far.max,
    isActive: true,
    sort: 1,
  },
  {
    key: "express_tehran",
    name: "ارسال فوری تهران",
    description: "تحویل در همان روز یا روز بعد، فقط در تهران",
    kind: "flat",
    rateJson: { flat: 0 },
    provinces: ["THR"],
    etaMinDays: 0,
    etaMaxDays: 1,
    isActive: false,
    sort: 2,
  },
  {
    key: "pickup",
    name: "تحویل حضوری در فروشگاه",
    description: "دریافت از فروشگاه در ساعات کاری",
    kind: "pickup",
    rateJson: {},
    provinces: ["THR"],
    etaMinDays: 0,
    etaMaxDays: 0,
    isActive: false,
    sort: 3,
  },
];

export const STAFF_ROLES: { name: RoleName; permissions: Permission[] }[] = (
  Object.keys(ROLE_PERMISSIONS) as RoleName[]
).map((name) => ({ name, permissions: [...ROLE_PERMISSIONS[name]] }));

/** the spec Labels are data (menu rows), not UI copy - the storefront renders `menus.items_json`. */
export const MENUS: Record<MenuKey, MenuItem[]> = {
  // Desktop nav row: the categories panel comes first (a component), then these destinations.
  header: [
    { label: "فروشگاه", href: "/shop/", kind: "url" },
    { label: "پیشنهادهای ویژه", href: "/discount/", kind: "url" },
    { label: "ژورنال", href: "/blog/", kind: "url" },
    { label: "فروشگاه حضوری", href: "/store/", kind: "page", ref: "store" },
  ],
  // The menu drawer's destinations; the account, help and contact blocks are components.
  drawer: [
    { label: "فروشگاه", href: "/shop/", kind: "url" },
    { label: "پیشنهادهای ویژه", href: "/discount/", kind: "url" },
    { label: "تازه‌رسیده‌ها", href: "/new/", kind: "url" },
    { label: "ژورنال", href: "/blog/", kind: "url" },
    { label: "فروشگاه حضوری", href: "/store/", kind: "page", ref: "store" },
  ],
  // §8.5 footer column «فروشگاه».
  footer_shop: [
    { label: "همهٔ محصولات", href: "/shop/", kind: "url" },
    { label: "پیشنهادهای ویژه", href: "/discount/", kind: "url" },
    { label: "تازه‌ها", href: "/new/", kind: "url" },
    { label: "هدیه", href: "/gifts/", kind: "url" },
    { label: "مقایسه", href: "/compare/", kind: "url" },
    { label: "علاقه‌مندی‌ها", href: "/wishlist/", kind: "url" },
  ],
  // §8.5 footer column «راهنمای خرید».
  footer_help: [
    // `ref` is the page SLUG, not its template name. The skeleton below is slugged
    // "shipping-returns" (the storefront links it that way), so a ref of "returns" - the template - 
    // resolved to no row and resolveMenuItem dropped the item: the published, eNamad-required
    // shipping-and-returns page was missing from the footer of every page (found 9 Sep 2026).
    { label: "ارسال و مرجوعی", href: "/shipping-returns/", kind: "page", ref: "shipping-returns" },
    { label: "گارانتی", href: "/warranty/", kind: "page", ref: "warranty" },
    { label: "خرید اقساطی", href: "/installments/", kind: "page", ref: "installments" },
    { label: "پیگیری سفارش", href: "/track/", kind: "url" },
    { label: "پرسش‌های پرتکرار", href: "/faq/", kind: "page", ref: "faq" },
    // A `page` item carries BOTH: `ref` is what resolveMenuItem looks the row up by (an item with
    // no ref is silently dropped) and `href` is only the fallback the admin list shows.
    { label: "دربارهٔ ما", href: "/about-us/", kind: "page", ref: "about-us" },
    { label: "تماس با ما", href: "/contact-us/", kind: "page", ref: "contact-us" },
  ],
  // §8.4 mobile tab bar.
  tabbar: [
    { label: "خانه", href: "/", kind: "url" },
    { label: "فروشگاه", href: "/shop/", kind: "url" },
    { label: "علاقه‌مندی‌ها", href: "/wishlist/", kind: "url" },
    { label: "سبد", href: "/cart/", kind: "url" },
  ],
};

/**
 * The five pages F-071 requires that have no legacy source (extract/pages.ts rules). They are
 * created as `draft` skeletons so nothing invented is ever published.
 * DECISION: explicit ids in a reserved band above every legacy page id (max 51,398). Fixtures runs
 * before the content stage, so a serial-allocated id could otherwise collide with a legacy page id
 * that the content stage then upserts over.
 */
export const PAGE_SKELETON_ID_BASE = 100_000;
export const PAGE_SKELETONS: { id: number; slug: string; title: string; template: PageTemplate }[] = [
  { id: PAGE_SKELETON_ID_BASE + 1, slug: "store", title: "فروشگاه حضوری", template: "store" },
  { id: PAGE_SKELETON_ID_BASE + 2, slug: "warranty", title: "گارانتی و خدمات پس از فروش", template: "warranty" },
  // DECISION (M8 browser check): the storefront links this page as /shipping-returns/ (home ServiceStrip, PDP TrustList), so the skeleton slug follows the link.
  { id: PAGE_SKELETON_ID_BASE + 3, slug: "shipping-returns", title: "ارسال و مرجوعی", template: "returns" },
  { id: PAGE_SKELETON_ID_BASE + 4, slug: "installments", title: "خرید اقساطی", template: "installments" },
  { id: PAGE_SKELETON_ID_BASE + 5, slug: "faq", title: "پرسش‌های پرتکرار", template: "faq" },
];

/** Dev-only owner identity (EDGE CASE: prod must supply SEED_OWNER_*). */
export const DEV_OWNER_EMAIL = "owner@namilux.local";
export const OWNER_ROLE: RoleName = "owner";

/**
 * DECISION: this is the one importer that reads `process.env` directly. Its contract names
 * SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD as env, `SeedContext` carries no field for them and
 * `@namilux/config` env has no SEED_OWNER_* key, so there is no other channel. Recorded in
 * the spec (context.ts "importers never read process.env" vs this contract).
 */
function ownerEnv(): { email: string | undefined; password: string | undefined; appEnv: string } {
  return {
    email: process.env["SEED_OWNER_EMAIL"]?.trim() || undefined,
    password: process.env["SEED_OWNER_PASSWORD"] || undefined,
    appEnv: process.env["APP_ENV"]?.trim() || "dev",
  };
}

/** 24 unbiased characters, printed once and never stored anywhere but the hash (the spec: no Math.random). */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

async function seedRoles(ctx: SeedContext): Promise<number> {
  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(staffRolesTable)
        .values(STAFF_ROLES.map((r) => ({ name: r.name, permissions: r.permissions })))
        // Upsert by name keeps the ids `staff_users.role_id` points at (rules: never delete a role in use).
        .onConflictDoUpdate({
          target: staffRolesTable.name,
          set: { permissions: sql`excluded.permissions` },
        });
    });
  }
  return STAFF_ROLES.length;
}

async function seedSettings(ctx: SeedContext): Promise<number> {
  const rows = SETTINGS_KEYS.map((key) => ({
    key,
    valueJson: DEFAULT_SETTINGS[key],
    updatedBy: "seed",
  }));
  const present = new Set(
    (
      await ctx.db
        .select({ key: settingsTable.key })
        .from(settingsTable)
        .where(inArray(settingsTable.key, [...SETTINGS_KEYS]))
    ).map((r) => r.key),
  );
  const missing = rows.filter((r) => !present.has(r.key));
  if (missing.length > 0 && !ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      // rules: only missing keys are written - a settings row is owner-editable and never reset.
      await tx.insert(settingsTable).values(missing).onConflictDoNothing({ target: settingsTable.key });
    });
  }
  return missing.length;
}

async function seedShippingMethods(ctx: SeedContext): Promise<number> {
  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(shippingMethodsTable)
        .values(SHIPPING_METHODS)
        .onConflictDoUpdate({
          target: shippingMethodsTable.key,
          set: {
            name: sql`excluded.name`,
            description: sql`excluded.description`,
            kind: sql`excluded.kind`,
            rateJson: sql`excluded.rate_json`,
            provinces: sql`excluded.provinces`,
            etaMinDays: sql`excluded.eta_min_days`,
            etaMaxDays: sql`excluded.eta_max_days`,
            isActive: sql`excluded.is_active`,
            sort: sql`excluded.sort`,
          },
        });
    });
  }
  return SHIPPING_METHODS.length;
}

async function seedMenus(ctx: SeedContext): Promise<number> {
  const rows = MENU_KEYS.map((key) => ({ key, itemsJson: MENUS[key] }));
  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(menusTable)
        .values(rows)
        .onConflictDoUpdate({ target: menusTable.key, set: { itemsJson: sql`excluded.items_json` } });
    });
  }
  return rows.length;
}

async function seedPageSkeletons(ctx: SeedContext): Promise<number> {
  const rows = PAGE_SKELETONS.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    bodyHtml: "",
    template: p.template,
    // Draft: the copy is a Phase-0 content job (OPEN(owner)); the seed never publishes invented text.
    status: "draft" as const,
  }));
  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(pagesTable)
        .values(rows)
        .onConflictDoUpdate({
          target: pagesTable.id,
          // Only the shape is re-asserted; `body_html` and `status` stay whatever the admin made them.
          set: { slug: sql`excluded.slug`, template: sql`excluded.template` },
        });
    });
  }
  return rows.length;
}

export async function ensureOwner(ctx: SeedContext): Promise<void> {
  const existing = await ctx.db.select({ id: staffUsersTable.id }).from(staffUsersTable).limit(1);
  if (existing.length > 0) {
    // Never overwrites an existing owner (contract) - not the password, not the role, not TOTP.
    ctx.log.info("owner already exists — unchanged");
    return;
  }

  const env = ownerEnv();
  const isProdLike = env.appEnv === "prod" || env.appEnv === "staging";
  if (isProdLike && (!env.email || !env.password)) {
    throw new Error(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required when APP_ENV is staging or prod " +
        "(the seed never generates a production password).",
    );
  }
  const email = env.email ?? DEV_OWNER_EMAIL;
  const generated = env.password === undefined;
  const password = env.password ?? generatePassword();

  const role = await ctx.db
    .select({ id: staffRolesTable.id })
    .from(staffRolesTable)
    .where(eq(staffRolesTable.name, OWNER_ROLE))
    .limit(1);
  const roleId = role[0]?.id;
  if (roleId === undefined) {
    // A dry run never wrote the roles, so there is nothing to point `role_id` at.
    if (ctx.dry) {
      ctx.log.info({ email }, "owner would be created (dry run)");
      return;
    }
    warn(ctx.report, "owner not created: the owner role row is missing (run the fixtures stage)");
    return;
  }

  const passwordHash = await hashPassword(password);

  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(staffUsersTable).values({
        id: ulid(),
        email,
        name: "مالک فروشگاه",
        passwordHash,
        roleId,
        isActive: true,
        // TOTP is enrolled on first login; the seed never holds a secret.
        totpEnabled: false,
        mustChangePassword: true,
      });
    });
  }
  ctx.report.fixtures.ownerCreated = true;
  if (generated) {
    // Printed once, to stderr, never logged as structured JSON and never stored.
    process.stderr.write(`[seed] owner ${email} created with the one-time password: ${password}\n`);
  }
  ctx.log.info({ email }, "owner created (must change password on first login)");
}

export async function run(ctx: SeedContext): Promise<void> {
  const roles = await seedRoles(ctx);
  const settingsKeys = await seedSettings(ctx);
  const shipping = await seedShippingMethods(ctx);
  const menuRows = await seedMenus(ctx);
  const pageSkeletons = await seedPageSkeletons(ctx);
  await ensureOwner(ctx);

  ctx.report.fixtures.roles = roles;
  ctx.report.fixtures.settingsKeys = settingsKeys;
  ctx.report.fixtures.shippingMethods = shipping;
  ctx.report.fixtures.menus = menuRows;
  ctx.report.fixtures.pageSkeletons = pageSkeletons;
  ctx.report.menus = menuRows;
  ctx.report.pageSkeletons = pageSkeletons;

  ctx.log.info({ roles, settingsKeys, shipping, menus: menuRows, pageSkeletons }, "fixtures stage done");
}
