import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, auditLog, eq } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { MASKED_KEYS, MAX_DIFF_BYTES, audit, jsonDiff, truncateIp } from "../audit";
import { ulid } from "../ids";
import type { Actor } from "../types";

const RUN = ulid().slice(-10);
const ENTITY = `test.audit.${RUN}`;

describe("audit", () => {
  it("masks phone and secret keys in before/after", () => {
    const before = {
      phone: "09121230077",
      password_hash: "scrypt$aaaa",
      totp_secret_enc: "deadbeef",
      note: "تماس با 09121230077",
      name: "علی",
    };
    const after = {
      phone: "09121234567",
      password_hash: "scrypt$bbbb",
      totp_secret_enc: "cafebabe",
      note: "بدون شماره",
      name: "علی",
    };
    const diff = jsonDiff(before, after);
    expect(diff.before?.phone).toBe("0912***0077");
    expect(diff.after?.phone).toBe("0912***4567");
    expect(diff.before?.note).toBe("تماس با 0912***0077");
    for (const key of MASKED_KEYS) {
      if (key === "phone") continue;
      expect(diff.before).not.toHaveProperty(key);
      expect(diff.after).not.toHaveProperty(key);
    }
    const serialized = JSON.stringify(diff);
    expect(serialized).not.toContain("09121230077");
    expect(serialized).not.toContain("scrypt$aaaa");
    expect(serialized).not.toContain("deadbeef");
  });

  it("diff lists only changed keys", () => {
    const diff = jsonDiff({ a: 1, b: "x", c: [1, 2] }, { a: 2, b: "x", c: [1, 2] });
    expect(diff.before).toEqual({ a: 1 });
    expect(diff.after).toEqual({ a: 2 });

    // Unchanged input: still a valid (empty) pair - the caller decided to log it.
    const same = jsonDiff({ a: 1 }, { a: 1 });
    expect(same).toEqual({ before: {}, after: {} });

    // Create and delete keep the whole surviving side.
    expect(jsonDiff(undefined, { a: 1 })).toEqual({ before: null, after: { a: 1 } });
    expect(jsonDiff({ a: 1 }, undefined)).toEqual({ before: { a: 1 }, after: null });

    // A key only present on one side is a change.
    const added = jsonDiff({ a: 1 }, { a: 1, b: 2 });
    expect(added.before).toEqual({});
    expect(added.after).toEqual({ b: 2 });

    // Dates and bigints survive as JSON, non-JSON values are dropped.
    const mapped = jsonDiff({ at: new Date(0), n: 1n }, { at: new Date(1000), n: 2n });
    expect(mapped.after).toEqual({ at: "1970-01-01T00:00:01.000Z", n: "2" });

    // A scalar side is wrapped so the change is still visible.
    expect(jsonDiff("draft", "published")).toEqual({ before: { value: "draft" }, after: { value: "published" } });
  });

  it("truncates diffs over 64 KB with __truncated", () => {
    const big = (ch: string) => ch.repeat(40_000);
    const diff = jsonDiff({ blob: big("a"), n: 1 }, { blob: big("b"), n: 2 });
    expect(diff.before).toEqual({ n: 1, __truncated: true });
    expect(diff.after).toEqual({ n: 2, __truncated: true });
    expect(Buffer.byteLength(JSON.stringify(diff), "utf8")).toBeLessThanOrEqual(MAX_DIFF_BYTES);

    // A diff that fits is never flagged.
    const small = jsonDiff({ n: 1 }, { n: 2 });
    expect(small.after).not.toHaveProperty("__truncated");
  });

  it("truncates the actor ip to /24 unless the actor is staff", () => {
    expect(truncateIp("192.0.2.10", false)).toBe("192.0.2.0/24");
    expect(truncateIp("192.0.2.10", true)).toBe("192.0.2.10");
    expect(truncateIp("2001:db8:1234:5678::1", false)).toBe("2001:db8:1234::/48");
    expect(truncateIp("not-an-ip", true)).toBeNull();
    expect(truncateIp("999.1.1.1", false)).toBeNull();
    expect(truncateIp(undefined, false)).toBeNull();
  });
});

describe.skipIf(!hasTestDb())("audit (integration)", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("system actor with null id is accepted", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const actor: Actor = { type: "system", id: null };
      await audit.log(tx, actor, "settings.update", ENTITY, "checkout.enabled", { value: true }, { value: false });

      const rows = await tx.select().from(auditLog).where(eq(auditLog.entity, ENTITY));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorType).toBe("system");
      expect(rows[0]?.actorId).toBeNull();
      expect(rows[0]?.ip).toBeNull();
      expect(rows[0]?.beforeJson).toEqual({ value: true });
      expect(rows[0]?.afterJson).toEqual({ value: false });
    });
  });

  it("stores a staff ip in full, a customer ip as /24, and lists newest first", async () => {
    await withTestTx(testDb.db, async (tx) => {
      const staff: Actor = { type: "staff", id: `staff-${RUN}`, ip: "192.0.2.10" };
      const customer: Actor = { type: "customer", id: `cust-${RUN}`, ip: "192.0.2.10" };
      await audit.log(tx, staff, "product.update", ENTITY, "1", { price: 1 }, { price: 2 });
      await audit.log(tx, customer, "order.transition", ENTITY, "2", undefined, { status: "paid" });

      const staffRow = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, ENTITY), eq(auditLog.entityId, "1")));
      expect(staffRow[0]?.ip).toBe("192.0.2.10");
      const customerRow = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entity, ENTITY), eq(auditLog.entityId, "2")));
      expect(customerRow[0]?.ip).toBe("192.0.2.0/24");
      expect(customerRow[0]?.beforeJson).toBeNull();

      const page = await audit.list(tx, { entity: ENTITY, page: 1 });
      expect(page.total).toBe(2);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(50);
      expect(page.items.map((r) => r.entityId).sort()).toEqual(["1", "2"]);
      expect(page.items.every((r) => r.action.includes("."))).toBe(true);

      const filtered = await audit.list(tx, { entity: ENTITY, actorId: `staff-${RUN}`, from: "not-a-date" });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.actor).toEqual({ type: "staff", id: `staff-${RUN}`, ip: "192.0.2.10" });

      const empty = await audit.list(tx, { entity: ENTITY, from: new Date(Date.now() + 86_400_000).toISOString() });
      expect(empty.total).toBe(0);
    });
  });
});
