import { describe, expect, it } from "vitest";
import { ROLE_NAMES, type RoleName } from "../../constants";
import { isAppError } from "../../errors";
import { SETTINGS_KEYS } from "../../settings/schema";
import type { StaffUser } from "../../types";
import {
  MONEY_PERMISSIONS,
  MONEY_SETTINGS_KEYS,
  PERMISSIONS,
  ROLE_CHANNEL,
  ROLE_PERMISSIONS,
  SUDO_PERMISSIONS,
  assertCan,
  can,
  channelScope,
  isMoneySettingsKey,
  isRoleName,
  permissionsForRole,
  requiresSudo,
  type Permission,
} from "../permissions";

/** the spec §authz + the owner/admin split - the exhaustive Permission union, restated in doc order. */
const DOC_PERMISSIONS: Permission[] = [
  "catalog.read", "catalog.write", "catalog.price", "catalog.cost", "catalog.bulk", "media.write", "media.delete",
  "orders.read", "orders.write", "orders.refund", "orders.manual_payment", "orders.create",
  "customers.read", "customers.write", "customers.export", "customers.points",
  "inbox.read", "inbox.reply", "marketing.coupons", "marketing.banners", "marketing.sms", "marketing.loyalty",
  "content.write", "seo.write", "settings.read", "settings.write", "settings.money", "settings.security",
  "analytics.read", "staff.manage", "audit.read", "system.jobs", "system.cache",
];

/** MONEY is the owner's column: cost/margin, the money settings groups, sales reports, loyalty rules. */
const DOC_MONEY: Permission[] = ["catalog.cost", "settings.money", "analytics.read", "marketing.loyalty"];

/** Everything an `admin` may not do - money, staff, security, the bulk PII export, /system. */
const DOC_OWNER_ONLY: Permission[] = [
  ...DOC_MONEY,
  "settings.security",
  "staff.manage",
  "customers.export",
  "audit.read",
  "system.jobs",
  "system.cache",
];

/**
 * The customer's table, read row by row.
 *   owner   = every permission (the head admin)
 *   admin   = everything operational; none of DOC_OWNER_ONLY
 *   manager = admin + the read-only /system screens + the customer export; still no money
 *   the last four rows are the older, narrower roles, unchanged.
 */
const DOC_MATRIX: Record<RoleName, Permission[]> = {
  owner: DOC_PERMISSIONS,
  admin: DOC_PERMISSIONS.filter((p) => !DOC_OWNER_ONLY.includes(p)),
  // the instalment storefront's manager/accountant - every row confined to that site by ROLE_CHANNEL
  instalments: ["catalog.read", "orders.read", "orders.write", "orders.refund", "customers.read", "analytics.read"],
  manager: DOC_PERMISSIONS.filter((p) => !DOC_MONEY.includes(p) && p !== "settings.security" && p !== "staff.manage"),
  orders: ["catalog.read", "orders.read", "orders.write", "orders.create", "customers.read", "inbox.read", "inbox.reply"],
  content: ["catalog.read", "catalog.write", "media.write", "marketing.banners", "content.write", "seo.write"],
  support: ["catalog.read", "orders.read", "customers.read", "customers.write", "inbox.read", "inbox.reply"],
  // the spec last row, viewer column: "–/✓/–" → no staff.*, audit.read yes, no system.*
  viewer: ["catalog.read", "orders.read", "customers.read", "inbox.read", "settings.read", "audit.read"],
};

const staff = (role: string, isActive = true) =>
  ({ role, isActive }) as unknown as Pick<StaffUser, "role" | "isActive">;

const sorted = (p: readonly Permission[]) => [...p].sort();

describe("permission vocabulary", () => {
  it("PERMISSIONS is exactly the spec union", () => {
    expect(sorted(PERMISSIONS)).toEqual(sorted(DOC_PERMISSIONS));
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    expect(PERMISSIONS.length).toBe(33);
  });

  it("every SUDO permission exists in PERMISSIONS", () => {
    expect(SUDO_PERMISSIONS.length).toBeGreaterThan(0);
    expect(new Set(SUDO_PERMISSIONS).size).toBe(SUDO_PERMISSIONS.length);
    for (const p of SUDO_PERMISSIONS) {
      expect(PERMISSIONS, p).toContain(p);
      expect(requiresSudo(p), p).toBe(true);
    }
    // the destructive set of the spec is covered
    for (const p of ["catalog.bulk", "orders.refund", "settings.security", "staff.manage", "customers.export"] as Permission[]) {
      expect(requiresSudo(p), p).toBe(true);
    }
    expect(requiresSudo("catalog.read")).toBe(false);
    expect(requiresSudo("orders.read")).toBe(false);
    // Reading a cost price, a money settings group or a sales report must not demand a TOTP - 
    // those three gate GET routes too, and a sudo prompt on every read would be unusable.
    for (const p of ["catalog.cost", "settings.money", "analytics.read"] as Permission[]) {
      expect(requiresSudo(p), p).toBe(false);
    }
  });

  it("MONEY_PERMISSIONS are real permissions and belong to the owner alone - across both sites", () => {
    expect(sorted(MONEY_PERMISSIONS)).toEqual(sorted(DOC_MONEY));
    for (const p of MONEY_PERMISSIONS) {
      expect(PERMISSIONS, p).toContain(p);
      for (const role of ROLE_NAMES) {
        // The one exception: a role confined to one storefront reads THAT storefront's sales.
        const scopedSales = p === "analytics.read" && channelScope({ role }) !== null;
        expect(can(staff(role), p), `${role} → ${p}`).toBe(role === "owner" || scopedSales);
      }
    }
  });

  it("only the instalments role is confined to a storefront, and it is the instalment one", () => {
    expect(ROLE_CHANNEL).toEqual({ instalments: "instalments" });
    for (const role of ROLE_NAMES) expect(channelScope({ role }), role).toBe(role === "instalments" ? "instalments" : null);
    // A drifted role string is never read through Object.prototype.
    expect(channelScope({ role: "toString" as RoleName })).toBeNull();
    // Confined means read-only on everything shared with the main site.
    for (const p of ["catalog.write", "catalog.price", "catalog.bulk", "orders.create", "orders.manual_payment", "customers.write", "customers.export", "settings.read", "inbox.read"] as Permission[]) {
      expect(can(staff("instalments"), p), p).toBe(false);
    }
  });

  it("MONEY_SETTINGS_KEYS are real settings groups", () => {
    expect(MONEY_SETTINGS_KEYS).toEqual(["commerce.vat_percent", "commerce.installments", "loyalty.rules"]);
    for (const k of MONEY_SETTINGS_KEYS) {
      expect(SETTINGS_KEYS as readonly string[], k).toContain(k);
      expect(isMoneySettingsKey(k)).toBe(true);
    }
    for (const k of ["store.info", "store.contact", "shipping.copy", "promo.bar", "pwa.coach", "seo.defaults"]) {
      expect(isMoneySettingsKey(k), k).toBe(false);
    }
    // Not a settings key at all - and never coerced through Object.prototype.
    expect(isMoneySettingsKey("toString")).toBe(false);
    expect(isMoneySettingsKey("")).toBe(false);
  });
});

describe("ROLE_PERMISSIONS matches the customer's matrix", () => {
  it("matrix equals the table", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLE_NAMES].sort());
    for (const role of ROLE_NAMES) {
      expect(sorted(ROLE_PERMISSIONS[role]), role).toEqual(sorted(DOC_MATRIX[role]));
    }
  });

  for (const role of ROLE_NAMES) {
    it(`${role} has exactly its row of the table`, () => {
      const granted = ROLE_PERMISSIONS[role];
      expect(new Set(granted).size, role).toBe(granted.length);
      expect(sorted(granted)).toEqual(sorted(DOC_MATRIX[role]));
      for (const p of PERMISSIONS) {
        expect(can(staff(role), p), `${role} → ${p}`).toBe(DOC_MATRIX[role].includes(p));
      }
    });
  }

  it("owner has every permission", () => {
    expect(sorted(ROLE_PERMISSIONS.owner)).toEqual(sorted(PERMISSIONS));
  });

  it("admin runs the shop and never sees the money", () => {
    const admin = staff("admin");
    // everything operational
    for (const p of [
      "catalog.read", "catalog.write", "catalog.price", "catalog.bulk",
      "media.write", "media.delete",
      "orders.read", "orders.write", "orders.create", "orders.refund", "orders.manual_payment",
      "customers.read", "customers.write", "customers.points",
      "inbox.read", "inbox.reply",
      "marketing.coupons", "marketing.banners", "marketing.sms",
      "content.write", "seo.write", "settings.read", "settings.write",
    ] as Permission[]) {
      expect(can(admin, p), p).toBe(true);
    }
    // and nothing else
    for (const p of DOC_OWNER_ONLY) {
      expect(can(admin, p), p).toBe(false);
    }
    expect(ROLE_PERMISSIONS.admin.length).toBe(PERMISSIONS.length - DOC_OWNER_ONLY.length);
  });

  it("manager keeps the /system screens but not the money, staff or security", () => {
    const manager = staff("manager");
    expect(can(manager, "system.jobs")).toBe(true);
    expect(can(manager, "system.cache")).toBe(true);
    expect(can(manager, "audit.read")).toBe(true);
    expect(can(manager, "customers.export")).toBe(true);
    expect(can(manager, "settings.security")).toBe(false);
    expect(can(manager, "staff.manage")).toBe(false);
    for (const p of MONEY_PERMISSIONS) expect(can(manager, p), p).toBe(false);
  });

  it("permissionsForRole returns the row and [] for an unknown role", () => {
    expect(permissionsForRole("orders")).toBe(ROLE_PERMISSIONS.orders);
    expect(permissionsForRole("ghost" as RoleName)).toEqual([]);
  });

  it("isRoleName accepts the declared rows and refuses drift", () => {
    for (const role of ROLE_NAMES) expect(isRoleName(role)).toBe(true);
    for (const bad of ["superuser", "", "__proto__", "constructor", "toString", "Owner"]) {
      expect(isRoleName(bad), bad).toBe(false);
    }
  });
});

describe("can / assertCan", () => {
  it("inactive user has no permissions", () => {
    for (const role of ROLE_NAMES) {
      for (const p of PERMISSIONS) {
        expect(can(staff(role, false), p), `${role} → ${p}`).toBe(false);
      }
    }
    expect(() => assertCan(staff("owner", false), "catalog.read")).toThrow();
  });

  it("an unknown role string (DB drift) is treated as no permissions", () => {
    for (const p of PERMISSIONS) {
      expect(can(staff("superuser"), p), p).toBe(false);
      expect(can(staff(""), p), p).toBe(false);
      expect(can(staff("__proto__"), p), p).toBe(false);
      expect(can(staff("constructor"), p), p).toBe(false);
      expect(can(staff("toString"), p), p).toBe(false);
    }
  });

  it("assertCan throws FORBIDDEN with the Persian message", () => {
    expect(() => assertCan(staff("owner"), "settings.security")).not.toThrow();
    try {
      assertCan(staff("viewer"), "catalog.write");
      throw new Error("assertCan did not throw");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (!isAppError(e)) return;
      expect(e.code).toBe("FORBIDDEN");
      expect(e.httpStatus).toBe(403);
      expect(e.fa).toBe("دسترسی ندارید");
      expect(e.fa).not.toMatch(/[0-9]/);
      expect(e.fa).not.toContain("catalog.write");
    }
  });

  it("viewer can read but never write", () => {
    const viewer = staff("viewer");
    for (const p of ["catalog.read", "orders.read", "customers.read", "inbox.read", "settings.read", "audit.read"] as Permission[]) {
      expect(can(viewer, p), p).toBe(true);
    }
    const writes = PERMISSIONS.filter((p) => !p.endsWith(".read"));
    expect(writes.length).toBeGreaterThan(15);
    for (const p of writes) {
      expect(can(viewer, p), p).toBe(false);
    }
  });
});
