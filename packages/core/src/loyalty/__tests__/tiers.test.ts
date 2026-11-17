import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, jobs as jobsTable } from "@namilux/db";
import { makeCustomer, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { DEFAULT_LOYALTY_RULES } from "../rules";
import { grantBirthdayCoupons, nextTier, recomputeTiers, tierForSpend } from "../tiers";

const RULES = DEFAULT_LOYALTY_RULES;

describe("loyalty tiers - pure", () => {
  it("tierForSpend follows the thresholds table 0 / 50M / 200M / 500M", () => {
    expect(tierForSpend(RULES, 0)).toBe("member");
    expect(tierForSpend(RULES, 49_999_999)).toBe("member");
    expect(tierForSpend(RULES, 50_000_000)).toBe("silver");
    expect(tierForSpend(RULES, 199_999_999)).toBe("silver");
    expect(tierForSpend(RULES, 200_000_000)).toBe("gold");
    expect(tierForSpend(RULES, 500_000_000)).toBe("diamond");
    expect(tierForSpend(RULES, 5_000_000_000)).toBe("diamond");
  });

  it("nextTier reports the remaining spend", () => {
    expect(nextTier("member", RULES, 10_000_000)).toEqual({ tier: "silver", remaining: 40_000_000 });
    expect(nextTier("silver", RULES, 60_000_000)).toEqual({ tier: "gold", remaining: 140_000_000 });
    expect(nextTier("gold", RULES, 200_000_000)).toEqual({ tier: "diamond", remaining: 300_000_000 });
    expect(nextTier("diamond", RULES, 900_000_000)).toBeNull();
  });
});

describe.skipIf(!hasTestDb())("loyalty tiers — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  it("recomputeTiers upgrades once and enqueues the tier_up sms", async () => {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    // two paid orders of the 41.5M seed product → 83M rolling spend → silver
    await paidOrder(handle.db, { productId: seed.productId, customerId: seed.customerId }, actor);
    await paidOrder(handle.db, { productId: seed.productId, customerId: seed.customerId }, actor);
    const first = await recomputeTiers(handle.db, new Date(), RULES);
    expect(first).toEqual({ upgraded: 1, downgraded: 0 });
    const row = await handle.db.select({ tier: customers.tier }).from(customers).where(eq(customers.id, seed.customerId));
    expect(row[0]?.tier).toBe("silver");
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "loyalty.tier_up");
    expect(sms).toHaveLength(1);
    // a second run changes nothing and sends nothing more
    expect(await recomputeTiers(handle.db, new Date(), RULES)).toEqual({ upgraded: 0, downgraded: 0 });
    const again = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "loyalty.tier_up");
    expect(again).toHaveLength(1);
  });

  it("downgrades are silent", async () => {
    const c = await makeCustomer(handle.db, { tier: "gold" });
    const res = await recomputeTiers(handle.db, new Date(), RULES);
    expect(res).toEqual({ upgraded: 0, downgraded: 1 });
    const row = await handle.db.select({ tier: customers.tier }).from(customers).where(eq(customers.id, c.id));
    expect(row[0]?.tier).toBe("member");
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send");
    expect(sms).toHaveLength(0);
  });

  it("birthday coupon granted once per year", async () => {
    const today = new Date(2026, 7, 29); // local 29 Aug 2026 - grantBirthdayCoupons compares local month/day
    await makeCustomer(handle.db, { tier: "silver", birthday: "1990-08-29" });
    await makeCustomer(handle.db, { tier: "member", birthday: "1990-08-29" }); // below minTier silver → no grant
    await makeCustomer(handle.db, { tier: "gold", birthday: "1990-08-30" }); // not today
    expect(await grantBirthdayCoupons(handle.db, today, RULES)).toBe(1);
    // the unique key (customer + year) makes a rerun a no-op for the queue
    await grantBirthdayCoupons(handle.db, today, RULES);
    const jobs = (await handle.db.select().from(jobsTable)).filter((j) => j.payloadJson["template"] === "birthday.coupon");
    expect(jobs).toHaveLength(1);
  });

  it("30 Esfand birthday handled in non-leap years", async () => {
    // DECISION: birthdays are stored as Gregorian dates (customers.birthday DATE), so a 30 Esfand
    // birthday lives on its Gregorian anniversary (20 March) and matches every year, leap or not.
    await makeCustomer(handle.db, { tier: "silver", birthday: "2000-03-20" });
    expect(await grantBirthdayCoupons(handle.db, new Date(2026, 2, 20), RULES)).toBe(1);
    expect(await grantBirthdayCoupons(handle.db, new Date(2026, 2, 21), RULES)).toBe(0);
  });
});
