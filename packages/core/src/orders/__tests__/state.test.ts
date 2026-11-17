import { describe, expect, it } from "vitest";
import { ALLOWED, assertTransition, canTransition } from "../state";

describe("order state machine", () => {
  it("ALLOWED equals the spec table (snapshot)", () => {
    expect(ALLOWED).toEqual({
      draft: ["pending_payment", "paid", "cancelled"],
      pending_payment: ["paid", "failed", "expired", "cancelled"],
      paid: ["processing", "cancelled", "refunded"],
      processing: ["shipped", "cancelled", "refunded"],
      shipped: ["delivered", "refunded"],
      delivered: ["returned", "refunded"],
      failed: ["pending_payment"],
      expired: ["pending_payment"],
      cancelled: [],
      refunded: [],
      returned: [],
    });
  });

  it("canTransition allows table entries and rejects the rest", () => {
    expect(canTransition("pending_payment", "paid")).toBe(true);
    expect(canTransition("paid", "shipped")).toBe(false); // must go through processing
    expect(canTransition("cancelled", "paid")).toBe(false); // terminal
    expect(canTransition("delivered", "returned")).toBe(true);
  });

  it("assertTransition throws CONFLICT on an illegal jump", () => {
    expect(() => assertTransition("pending_payment", "shipped")).toThrow();
    try {
      assertTransition("refunded", "paid");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("CONFLICT");
    }
  });
});
