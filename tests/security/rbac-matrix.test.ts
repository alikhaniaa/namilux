import { describe, expect, it } from "vitest";
import { MONEY_PERMISSIONS, PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, can, channelScope } from "@namilux/core";
import type { RoleName, StaffUser } from "@namilux/core";

function user(role: RoleName, isActive = true): Pick<StaffUser, "role" | "isActive"> {
  return { role, isActive };
}

describe("security/rbac - matrix", () => {
  it("every role's permission set is a subset of the full permission list", () => {
    for (const role of ROLE_NAMES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it("owner has every permission; viewer cannot write anything", () => {
    for (const p of PERMISSIONS) expect(can(user("owner"), p)).toBe(true);
    const writes = PERMISSIONS.filter((p) => p.includes(".write") || p.includes(".price") || p.includes(".bulk") || p.includes(".manage"));
    for (const p of writes) expect(can(user("viewer"), p)).toBe(false);
  });

  it("staff.manage and settings.security are owner-only", () => {
    for (const role of ROLE_NAMES) {
      const owner = role === "owner";
      expect(can(user(role), "staff.manage")).toBe(owner);
      expect(can(user(role), "settings.security")).toBe(owner);
    }
  });

  it("the money permissions are owner-only - cost, the money settings, sales reports, loyalty rules", () => {
    for (const role of ROLE_NAMES) {
      // …save the sales reports of a role confined to one storefront, which are that site's alone.
      for (const p of MONEY_PERMISSIONS) expect(can(user(role), p), `${role} → ${p}`).toBe(role === "owner" || (p === "analytics.read" && channelScope({ role }) !== null));
    }
    // …and `admin`, the everyday back-office role, still runs the shop.
    for (const p of ["catalog.write", "catalog.price", "orders.write", "orders.refund", "marketing.sms", "content.write"] as const) {
      expect(can(user("admin"), p), p).toBe(true);
    }
  });

  it("an inactive staff member has no permissions regardless of role", () => {
    for (const role of ROLE_NAMES) for (const p of PERMISSIONS) expect(can(user(role, false), p)).toBe(false);
  });
});
