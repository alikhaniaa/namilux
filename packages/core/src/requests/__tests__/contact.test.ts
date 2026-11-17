import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, jobs as jobsTable, questions } from "@namilux/db";
import { makeCustomer } from "../../__tests__/support/fixtures";
import { contact, newsletter } from "../contact";

describe.skipIf(!hasTestDb())("contact + newsletter", () => {
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

  it("submit enqueues a telegram notification", async () => {
    const res = await contact.submit(handle.db, { name: "علی رضایی", phone: "۰۹۱۲۱۲۳۴۵۶۷", message: "سلام، دربارهٔ گارانتی کتری سؤال دارم.", powToken: "test", ip: "1.2.3.4" });
    expect(res.id).toMatch(/^[0-9A-Z]{26}$/);
    const row = (await handle.db.select().from(questions).where(eq(questions.id, res.id)))[0];
    expect(row?.kind).toBe("contact");
    expect(row?.phone).toBe("09121234567"); // Persian digits normalised at the boundary
    expect(row?.productId).toBeNull();
    const tg = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["questionId"] === res.id);
    expect(tg).toHaveLength(1);
    expect(tg[0]?.payloadJson["event"]).toBe("contact.message");
    const listed = await contact.list(handle.db, { status: "pending" });
    expect(listed.total).toBe(1);
    await expect(contact.submit(handle.db, { name: "x", phone: "02188888888", message: "شمارهٔ ثابت پذیرفته نمی‌شود", powToken: "t", ip: "1.2.3.4" })).rejects.toThrow();
  });

  it("subscribe is idempotent and sets marketing_opt_in on an existing account", async () => {
    const c = await makeCustomer(handle.db);
    expect(await newsletter.subscribe(handle.db, { phone: c.phone, optIn: true, powToken: "t", ip: "1.2.3.4" })).toEqual({ status: "subscribed" });
    expect(await newsletter.subscribe(handle.db, { phone: c.phone, optIn: true, powToken: "t", ip: "1.2.3.4" })).toEqual({ status: "already" });
    const row = (await handle.db.select().from(customers).where(eq(customers.id, c.id)))[0];
    expect(row?.marketingOptIn).toBe(true);
    // an unknown phone gets a customer row (opt-in lives on the customer, the spec)
    expect(await newsletter.subscribe(handle.db, { phone: "09129990001", optIn: true, powToken: "t", ip: "1.2.3.4" })).toEqual({ status: "subscribed" });
    const created = (await handle.db.select().from(customers).where(eq(customers.phone, "09129990001")))[0];
    expect(created?.marketingOptIn).toBe(true);
    expect(await handle.db.select().from(customers)).toHaveLength(2);
  });

  it("unsubscribe clears opt-in and is a no-op for unknown phones", async () => {
    const c = await makeCustomer(handle.db, { marketingOptIn: true });
    await newsletter.unsubscribe(handle.db, c.phone);
    const row = (await handle.db.select().from(customers).where(eq(customers.id, c.id)))[0];
    expect(row?.marketingOptIn).toBe(false);
    await expect(newsletter.unsubscribe(handle.db, "09120000000")).resolves.toBeUndefined();
    await expect(newsletter.unsubscribe(handle.db, "not-a-phone")).resolves.toBeUndefined();
    expect(await handle.db.select().from(customers)).toHaveLength(1);
  });
});
