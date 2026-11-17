import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, products, questions, sql } from "@namilux/db";
import { ulid } from "../../ids";
import { concierge, whatsappPrefill } from "../concierge";

describe("concierge - pure", () => {
  it("whatsappPrefill includes the name, sku and url", () => {
    expect(whatsappPrefill({ displayName: "اجاق اسمگ", sku: "SF6390X", url: "https://namilux.ir/product/x/" })).toBe(
      "سلام، قیمت و موجودی «اجاق اسمگ» (کد SF6390X) را می‌خواهم. https://namilux.ir/product/x/",
    );
  });
});

describe.skipIf(!hasTestDb())("concierge — integration", () => {
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

  async function makeProduct(): Promise<number> {
    const [p] = await handle.db.insert(products).values({ slug: `cc-${ulid()}`, name: "کالا", displayName: "کالای مشاوره", status: "active", visibility: "public", price: 0, stockQty: 0 }).returning({ id: products.id });
    return p!.id;
  }

  it("a request lands in the questions table as a kind='price' row; dedupes within 24 h", async () => {
    const productId = await makeProduct();
    const first = await concierge.request(handle.db, { productId, phone: "09121230077", note: "قیمت؟", customerId: null, ip: "1.2.3.4" });
    const rows = await handle.db.select().from(questions).where(eq(questions.id, first.id));
    expect(rows[0]).toMatchObject({ kind: "price", productId, status: "pending", body: "قیمت؟" });

    const second = await concierge.request(handle.db, { productId, phone: "۰۹۱۲۱۲۳۰۰۷۷", customerId: null, ip: "1.2.3.4" });
    expect(second.id).toBe(first.id); // deduped
    const all = await handle.db.select().from(questions).where(eq(questions.productId, productId));
    expect(all).toHaveLength(1);
  });

  it("counts reports pending concierge requests", async () => {
    const productId = await makeProduct();
    await concierge.request(handle.db, { productId, phone: "09120000001", customerId: null, ip: "1.2.3.4" });
    const counts = await concierge.counts(handle.db);
    expect(counts.pending).toBeGreaterThanOrEqual(1);
  });

  it("the storefront role can read only its customer's requests without access to product costs", async () => {
    const productId = await makeProduct();
    const customerId = ulid();
    await handle.db.insert(customers).values({ id: customerId, phone: "09000000001", referralCode: ulid() });
    await handle.db.insert(questions).values([
      { id: ulid(), productId, customerId, phone: "09000000001", kind: "price", body: "درخواست من" },
      { id: ulid(), productId, customerId: null, phone: "09000000002", kind: "price", body: "درخواست دیگری" },
    ]);
    await handle.db.transaction(async (tx) => {
      await tx.execute(sql`set local role nl_web`);
      const result = await concierge.listForCustomer(tx, customerId);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ customerId, productName: "کالای مشاوره", body: "درخواست من" });
      expect(await concierge.listForCustomer(tx, ulid())).toEqual([]);
    });
  });

  it("a request belongs to the storefront it was sent from", async () => {
    const productId = await makeProduct();
    const customerId = ulid();
    await handle.db.insert(customers).values({ id: customerId, phone: "09121230078", referralCode: ulid() });
    const main = await concierge.request(handle.db, { productId, phone: "09121230078", customerId, ip: "1.2.3.4" });
    const inst = await concierge.request(handle.db, { productId, phone: "09121230078", customerId, ip: "1.2.3.4", channel: "instalments" });
    // the same shopper on both sites within 24 h: two requests, because the two answers quote two prices
    expect(inst.id).not.toBe(main.id);
    expect((await concierge.listForCustomer(handle.db, customerId, "main")).map((r) => r.id)).toEqual([main.id]);
    const own = await concierge.listForCustomer(handle.db, customerId, "instalments");
    expect(own.map((r) => [r.id, r.channel])).toEqual([[inst.id, "instalments"]]);
    // «انتشار قیمت» writes the main site's fixed price, so it is refused for an instalment request
    const actor = { type: "staff" as const, id: ulid() };
    await expect(concierge.answer(handle.db, inst.id, "پاسخ", actor, { sendSms: false, publishPrice: 111_000_000 })).rejects.toThrow();
    const [row] = await handle.db.select().from(questions).where(eq(questions.id, inst.id));
    expect(row?.status).toBe("pending");
    const [product] = await handle.db.select({ price: products.price }).from(products).where(eq(products.id, productId));
    expect(product?.price).toBe(0);
  });
});
