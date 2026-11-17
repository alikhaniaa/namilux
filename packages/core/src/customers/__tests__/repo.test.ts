import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { createForPhone, findByPhone, upsertByPhone } from "../repo";

describe.skipIf(!hasTestDb())("customers/repo against Postgres", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("createForPhone assigns an 8-char referral code and is found by phone", async () => {
    await withTestTx(handle.db, async (tx) => {
      const c = await createForPhone(tx, "09121110000", {});
      expect(c.phone).toBe("09121110000");
      expect(c.referralCode).toHaveLength(8);
      const again = await findByPhone(tx, "09121110000");
      expect(again?.id).toBe(c.id);
    });
  });

  it("upsertByPhone creates once (isNew true) then loads (isNew false)", async () => {
    await withTestTx(handle.db, async (tx) => {
      const first = await upsertByPhone(tx, "09121110001");
      expect(first.isNew).toBe(true);
      const second = await upsertByPhone(tx, "09121110001");
      expect(second.isNew).toBe(false);
      expect(second.customer.id).toBe(first.customer.id);
    });
  });
});
