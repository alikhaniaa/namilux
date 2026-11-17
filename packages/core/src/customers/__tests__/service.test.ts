import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { ensureCustomerForPhone, publicView } from "../service";
import { createForPhone, setBlocked } from "../repo";
import { isAppError } from "../../errors";
import type { Customer } from "../../types";

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: "0000000000000000000CUST001",
  phone: "09121112222",
  phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
  firstName: "علی",
  lastName: "رضایی",
  email: null,
  birthday: null,
  gender: null,
  tier: "member",
  pointsBalance: 120,
  referralCode: "ABCD2345",
  referredById: null,
  marketingOptIn: false,
  isBlocked: false,
  blockReason: null,
  adminNote: "internal",
  lastLoginAt: "2026-01-02T00:00:00.000Z",
  ordersCount: 0,
  lifetimeSpend: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("customers/service - publicView (pure)", () => {
  it("strips adminNote/blockReason and keeps the public fields", () => {
    const v = publicView(customer());
    expect(v).not.toHaveProperty("adminNote");
    expect(v).not.toHaveProperty("blockReason");
    expect(v.customerId).toBe("0000000000000000000CUST001");
    expect(v.pointsBalance).toBe(120);
    expect(v.lastOtpAt).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe.skipIf(!hasTestDb())("customers/service against Postgres", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("ensureCustomerForPhone creates once then loads", async () => {
    await withTestTx(handle.db, async (tx) => {
      const a = await ensureCustomerForPhone(tx, "09121113333", {});
      expect(a.isNew).toBe(true);
      const b = await ensureCustomerForPhone(tx, "09121113333", {});
      expect(b.isNew).toBe(false);
      expect(b.customer.id).toBe(a.customer.id);
    });
  });

  it("a blocked customer cannot pass ensureCustomerForPhone", async () => {
    await withTestTx(handle.db, async (tx) => {
      const c = await createForPhone(tx, "09121114444", {});
      await setBlocked(tx, c.id, true, "abuse");
      let caught: unknown = null;
      try {
        await ensureCustomerForPhone(tx, "09121114444", {});
      } catch (e) {
        caught = e;
      }
      expect(isAppError(caught) ? caught.code : null).toBe("FORBIDDEN");
    });
  });
});
