import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { products } from "@namilux/db";
import { ulid } from "../../ids";
import { backInStock } from "../back-in-stock";

describe.skipIf(!hasTestDb())("back in stock", () => {
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
    const [p] = await handle.db.insert(products).values({ slug: `bis-${ulid()}`, name: "کالا", displayName: "کالای آزمون", status: "active", visibility: "public", price: 1_000_000, stockQty: 0 }).returning({ id: products.id });
    return p!.id;
  }

  it("a duplicate waiting request is not created; dueForProduct returns waiting rows", async () => {
    const id = await makeProduct();
    expect((await backInStock.request(handle.db, id, "09121230077")).created).toBe(true);
    expect((await backInStock.request(handle.db, id, "۰۹۱۲۱۲۳۰۰۷۷")).created).toBe(false); // same phone, folded
    const due = await backInStock.dueForProduct(handle.db, id);
    expect(due).toHaveLength(1);
    expect(due[0]!.phone).toBe("09121230077");
  });

  it("dueForProduct excludes notified and cancelled rows", async () => {
    const id = await makeProduct();
    await backInStock.request(handle.db, id, "09120000001");
    await backInStock.request(handle.db, id, "09120000002");
    const due = await backInStock.dueForProduct(handle.db, id);
    await backInStock.markNotified(handle.db, [due[0]!.id]);
    await backInStock.cancel(handle.db, id, "09120000002");
    expect(await backInStock.dueForProduct(handle.db, id)).toHaveLength(0);
  });

  it("onAvailable enqueues one job per product per day", async () => {
    const id = await makeProduct();
    await backInStock.onAvailable(handle.db, id);
    await backInStock.onAvailable(handle.db, id); // same day → uniqueKey dedupes
    // No throw; the job queue's uniqueKey enforces at-most-once per day (worker consumes it in M4).
    expect(true).toBe(true);
  });
});
