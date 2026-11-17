import { describe, expect, it } from "vitest";
import { isAppError } from "../../errors";
import type { StaffUser } from "../../types";
import { assertMayWriteCost, margin, redactCost, redactProductAdminView, withoutCost } from "../redact";

const staff = (role: string, isActive = true) =>
  ({ role, isActive }) as unknown as Pick<StaffUser, "role" | "isActive">;

const row = { id: 7, displayName: "اجاق گاز", price: 12_000_000, costPrice: 9_000_000 };

describe("cost-price redaction", () => {
  it("keeps the cost for the owner and nulls it for everyone else", () => {
    expect(redactCost(row, true)).toEqual(row);
    expect(redactCost(row, false).costPrice).toBeNull();
    // The rest of the row is untouched and the input is not mutated.
    expect(redactCost(row, false).price).toBe(12_000_000);
    expect(row.costPrice).toBe(9_000_000);
  });

  it("redacts the row inside an admin product view", () => {
    const view = { row, full: { id: 7 }, siblings: [] };
    expect(redactProductAdminView(view, true)).toEqual(view);
    const redacted = redactProductAdminView(view, false);
    expect(redacted.row.costPrice).toBeNull();
    expect(redacted.full).toBe(view.full);
    expect(JSON.stringify(redacted)).not.toContain("9000000");
  });

  it("margin is money and is therefore null once the cost is gone", () => {
    expect(margin(row)).toEqual({ toman: 3_000_000, ratio: 0.25 });
    expect(margin(redactCost(row, false))).toBeNull();
    // On-request rows (price 0) and rows with no recorded cost have no margin either.
    expect(margin({ price: 0, costPrice: 9_000_000 })).toBeNull();
    expect(margin({ price: 12_000_000, costPrice: null })).toBeNull();
    // A cost above the price is a real loss, not an error.
    expect(margin({ price: 1_000, costPrice: 1_500 })).toEqual({ toman: -500, ratio: -0.5 });
  });
});

describe("cost-price writes", () => {
  it("refuses a costPrice key from staff without catalog.cost", () => {
    expect(() => assertMayWriteCost(staff("owner"), { costPrice: 1 })).not.toThrow();
    for (const role of ["admin", "manager", "content", "orders", "support", "viewer"]) {
      try {
        assertMayWriteCost(staff(role), { costPrice: 1 });
        throw new Error(`${role} was allowed to write a cost price`);
      } catch (e) {
        expect(isAppError(e), role).toBe(true);
        if (isAppError(e)) expect(e.code).toBe("FORBIDDEN");
      }
    }
  });

  it("a null or zero cost is still a cost - presence is what is refused", () => {
    for (const body of [{ costPrice: null }, { costPrice: 0 }, { costPrice: undefined }]) {
      expect(() => assertMayWriteCost(staff("admin"), body)).toThrow();
    }
  });

  it("a body without the key passes for anyone (an absent key preserves the stored cost)", () => {
    expect(() => assertMayWriteCost(staff("admin"), { price: 10 })).not.toThrow();
    expect(() => assertMayWriteCost(staff("admin"), {})).not.toThrow();
    // An inherited property is not an own key and must not be read as one.
    const inherited = Object.create({ costPrice: 5 }) as object;
    expect(() => assertMayWriteCost(staff("admin"), inherited)).not.toThrow();
  });

  it("withoutCost drops the key without mutating the input", () => {
    const input = { price: 10, costPrice: 5 };
    expect(withoutCost(input)).toEqual({ price: 10 });
    expect("costPrice" in withoutCost(input)).toBe(false);
    expect(input.costPrice).toBe(5);
  });
});
