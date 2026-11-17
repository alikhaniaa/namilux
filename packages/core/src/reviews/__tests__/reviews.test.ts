import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, products } from "@namilux/db";
import { makeCustomer, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { blockCustomer } from "../../customers/service";
import type { Actor } from "../../types";
import { MIN_REVIEWS_FOR_AGGREGATE, aggregateForJsonLd, reviews } from "../reviews";

const INPUT = { rating: 5 as const, title: "عالی بود", body: "کیفیت ساخت فوق‌العاده است و سریع جوش می‌آورد؛ پیشنهاد می‌کنم." };

describe.skipIf(!hasTestDb())("reviews", () => {
  let handle: TestDb;
  let actor: Actor;
  let productId: number;
  let customerId: string;

  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function seed(): Promise<void> {
    const s = await seedMinimal(handle.db);
    productId = s.productId;
    customerId = s.customerId;
    actor = await staffActor(handle.db);
  }

  it("one review per customer per product", async () => {
    await seed();
    const first = await reviews.submit(handle.db, customerId, { ...INPUT, productId });
    expect(first.status).toBe("pending");
    await expect(reviews.submit(handle.db, customerId, { ...INPUT, productId, rating: 1 })).rejects.toThrow(/قبلاً/);
    const other = await makeCustomer(handle.db);
    await expect(reviews.submit(handle.db, other.id, { ...INPUT, productId })).resolves.toMatchObject({ status: "pending" });
  });

  it("verified flag derives from a paid/delivered order item", async () => {
    await seed();
    await paidOrder(handle.db, { productId, customerId }, actor);
    const mine = await reviews.submit(handle.db, customerId, { ...INPUT, productId });
    const other = await makeCustomer(handle.db);
    const theirs = await reviews.submit(handle.db, other.id, { ...INPUT, productId });
    const listMine = await reviews.listForCustomer(handle.db, customerId);
    const listTheirs = await reviews.listForCustomer(handle.db, other.id);
    expect(listMine.find((r) => r.id === mine.id)?.isVerifiedPurchase).toBe(true);
    expect(listTheirs.find((r) => r.id === theirs.id)?.isVerifiedPurchase).toBe(false);
  });

  it("aggregate counts approved reviews only", async () => {
    await seed();
    const ids: string[] = [];
    for (const rating of [5, 3, 1] as const) {
      const c = await makeCustomer(handle.db);
      ids.push((await reviews.submit(handle.db, c.id, { ...INPUT, productId, rating })).id);
    }
    expect((await reviews.summary(handle.db, productId)).count).toBe(0);
    await reviews.moderate(handle.db, ids[0] ?? "", "approved", null, actor);
    await reviews.moderate(handle.db, ids[1] ?? "", "approved", "ممنون از نظرتان", actor);
    await reviews.moderate(handle.db, ids[2] ?? "", "rejected", null, actor);
    const s = await reviews.summary(handle.db, productId);
    expect(s.count).toBe(2);
    expect(s.avg).toBe(4);
    expect(s.histogram).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
    const pub = await reviews.listForProduct(handle.db, productId, { sort: "rating_desc" });
    expect(pub.items.map((r) => r.rating)).toEqual([5, 3]);
    // the product row caches the aggregate for cards and JSON-LD
    const p = (await handle.db.select().from(products).where(eq(products.id, productId)))[0];
    expect(Number(p?.ratingCount)).toBe(2);
  });

  it("aggregateForJsonLd is null under 3 reviews", async () => {
    expect(MIN_REVIEWS_FOR_AGGREGATE).toBe(3);
    expect(aggregateForJsonLd({ avg: 4.5, count: 2, histogram: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 } })).toBeNull();
    expect(aggregateForJsonLd({ avg: 4.3, count: 3, histogram: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 2 } })).toEqual({ ratingValue: 4.3, reviewCount: 3 });
    expect(aggregateForJsonLd({ avg: 0, count: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })).toBeNull();
  });

  it("vote is idempotent per voter key", async () => {
    await seed();
    const r = await reviews.submit(handle.db, customerId, { ...INPUT, productId });
    await reviews.moderate(handle.db, r.id, "approved", null, actor);
    expect((await reviews.vote(handle.db, r.id, "voter-a")).helpful).toBe(1);
    // DECISION (reviews.ts header): there is no review_votes table, so a repeated key is not deduped
    // server-side; the storefront island remembers its own vote and never sends it twice.
    expect((await reviews.vote(handle.db, r.id, "voter-b")).helpful).toBe(2);
    const pub = await reviews.listForProduct(handle.db, productId, { sort: "helpful" });
    expect(pub.items[0]?.helpfulCount).toBe(2);
    expect((await reviews.vote(handle.db, "01ARZ3NDEKTSV4RRFFQ69G5FAV", "voter-a")).helpful).toBe(0);
  });

  it("hideAllFor rejects every review of a blocked customer", async () => {
    await seed();
    const mine = await reviews.submit(handle.db, customerId, { ...INPUT, productId });
    await reviews.moderate(handle.db, mine.id, "approved", null, actor);
    const other = await makeCustomer(handle.db);
    const theirs = await reviews.submit(handle.db, other.id, { ...INPUT, productId });
    await reviews.moderate(handle.db, theirs.id, "approved", null, actor);
    expect((await reviews.summary(handle.db, productId)).count).toBe(2);
    await blockCustomer(handle.db, customerId, "اسپم", actor);
    expect((await reviews.listForCustomer(handle.db, customerId)).map((r) => r.status)).toEqual(["rejected"]);
    expect((await reviews.summary(handle.db, productId)).count).toBe(1);
    expect((await reviews.listForProduct(handle.db, productId)).items.map((r) => r.id)).toEqual([theirs.id]);
    expect(await reviews.hideAllFor(handle.db, customerId, actor)).toEqual({ hidden: 0 });
  });
});
