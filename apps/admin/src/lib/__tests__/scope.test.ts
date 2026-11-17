import type * as Core from "@namilux/core";
import type { Order, StaffUser } from "@namilux/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requireStaff: () => Promise.resolve(null) }));
const findByCode = vi.fn<(db: unknown, code: string) => Promise<Pick<Order, "id" | "channel"> | null>>();
vi.mock("@namilux/core", async (orig) => {
  const actual = await orig<typeof Core>();
  return { ...actual, ordersRepo: { ...actual.ordersRepo, findByCode: (db: unknown, code: string) => findByCode(db, code) } };
});

const { inScope, scopedOrderByCode, siteFor } = await import("../scope");

function staffOf(role: StaffUser["role"]): StaffUser {
  return { id: "01HZX0000000000000000000S1", email: "x@y.z", name: "x", role, permissions: [], isActive: true, totpEnabled: true, sudoUntil: null, sessionId: "s", mustChangePassword: false };
}

describe("lib/scope - the storefront a staff member may see", () => {
  it("a confined role always gets its own site, whatever the request asked for", () => {
    const s = staffOf("instalments");
    expect(siteFor(s, "main")).toBe("instalments");
    expect(siteFor(s, null)).toBe("instalments");
    expect(siteFor(s, "anything")).toBe("instalments");
  });

  it("an unconfined role gets the site it asked for, and only a real one", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      const s = staffOf(role);
      expect(siteFor(s, "main")).toBe("main");
      expect(siteFor(s, "instalments")).toBe("instalments");
      expect(siteFor(s, "nope")).toBeUndefined();
      expect(siteFor(s, undefined)).toBeUndefined();
    }
  });

  it("inScope lets the owner see both sites and the instalment role only its own", () => {
    expect(inScope(staffOf("owner"), "main")).toBe(true);
    expect(inScope(staffOf("owner"), "instalments")).toBe(true);
    expect(inScope(staffOf("instalments"), "instalments")).toBe(true);
    expect(inScope(staffOf("instalments"), "main")).toBe(false);
  });

  it("an order of the other site answers exactly like a missing one", async () => {
    findByCode.mockResolvedValueOnce({ id: "o1", channel: "main" });
    await expect(scopedOrderByCode(staffOf("instalments"), "NL-AAAAA")).rejects.toMatchObject({ code: "NOT_FOUND" });
    findByCode.mockResolvedValueOnce(null);
    await expect(scopedOrderByCode(staffOf("instalments"), "NL-BBBBB")).rejects.toMatchObject({ code: "NOT_FOUND" });
    findByCode.mockResolvedValueOnce({ id: "o2", channel: "instalments" });
    await expect(scopedOrderByCode(staffOf("instalments"), "NL-CCCCC")).resolves.toMatchObject({ id: "o2" });
    findByCode.mockResolvedValueOnce({ id: "o3", channel: "main" });
    await expect(scopedOrderByCode(staffOf("owner"), "NL-DDDDD")).resolves.toMatchObject({ id: "o3" });
  });
});
