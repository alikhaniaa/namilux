import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { addresses } from "../addresses";
import type { AddressInput } from "../../validation/address";
import { isAppError } from "../../errors";

const input = (over: Partial<AddressInput> = {}): AddressInput => ({
  label: "خانه",
  recipientName: "علی رضایی",
  recipientPhone: "09121112222",
  province: "THR",
  city: "تهران",
  address: "خیابان آزادی، کوچهٔ بهار، پلاک ۱۲",
  postcode: "1391654321",
  isDefault: false,
  ...over,
});

describe.skipIf(!hasTestDb())("customers/addresses against Postgres", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("the first address becomes the default", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { customerId } = await seedMinimal(tx);
      const a = await addresses.create(tx, customerId, input());
      expect(a.isDefault).toBe(true);
    });
  });

  it("a city that is not in the province is rejected", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { customerId } = await seedMinimal(tx);
      let caught: unknown = null;
      try {
        await addresses.create(tx, customerId, input({ city: "تبریز" }));
      } catch (e) {
        caught = e;
      }
      expect(isAppError(caught) ? caught.code : null).toBe("VALIDATION");
    });
  });

  it("cannot read another customer's address", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { customerId } = await seedMinimal(tx);
      const a = await addresses.create(tx, customerId, input());
      expect(await addresses.get(tx, "0000000000000000000OTHER01", a.id)).toBeNull();
    });
  });

  it("removing the default promotes the newest remaining", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { customerId } = await seedMinimal(tx);
      const first = await addresses.create(tx, customerId, input({ label: "اول" }));
      const second = await addresses.create(tx, customerId, input({ label: "دوم" }));
      expect(first.isDefault).toBe(true);
      await addresses.remove(tx, customerId, first.id);
      const list = await addresses.list(tx, customerId);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(second.id);
      expect(list[0]?.isDefault).toBe(true);
    });
  });
});

describe("customers/addresses - pure snapshot", () => {
  it("snapshot carries no ids", () => {
    const snap = addresses.snapshot({
      id: "x",
      customerId: "y",
      label: "خانه",
      recipientName: "علی",
      recipientPhone: "09121112222",
      province: "THR",
      city: "تهران",
      address: "نشانی",
      plaque: null,
      unit: null,
      postcode: "1391654321",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snap).not.toHaveProperty("id");
    expect(snap).not.toHaveProperty("customerId");
    expect(snap.city).toBe("تهران");
  });
});
