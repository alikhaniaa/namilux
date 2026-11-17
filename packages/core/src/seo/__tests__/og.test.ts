import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, jobs as jobsTable, media } from "@namilux/db";
import type { Db } from "@namilux/db";
import { ulid } from "../../ids";
import { ensureOg, ogKeyFor, ogUrl } from "../og";

describe("og keys", () => {
  it("ogKeyFor is deterministic and ASCII", () => {
    expect(ogKeyFor({ kind: "product", id: 1044 })).toBe("og/p/1044.jpg");
    expect(ogKeyFor({ kind: "brand", id: 7 })).toBe("og/b/7.jpg");
    expect(ogKeyFor({ kind: "collection", id: 3 })).toBe("og/c/3.jpg");
    expect(ogKeyFor({ kind: "category", id: 12 })).toBe("og/cat/12.jpg");
    expect(ogKeyFor({ kind: "site" })).toBe("og/site.jpg");
    // A Persian post slug is hashed into an ASCII key.
    const key = ogKeyFor({ kind: "post", slug: "راهنمای-خرید" });
    expect(key).toMatch(/^og\/post\/[a-f0-9]{16}\.jpg$/);
    expect(ogKeyFor({ kind: "post", slug: "راهنمای-خرید" })).toBe(key); // deterministic
  });

  it("ogUrl routes the key through the given mediaUrl", () => {
    expect(ogUrl("og/site.jpg", (k) => `/media/${k}`)).toBe("/media/og/site.jpg");
  });
});

describe.skipIf(!hasTestDb())("ensureOg", () => {
  let tdb: TestDb;
  let db: Db;
  beforeAll(async () => {
    tdb = await createTestDb();
    db = tdb.db;
  });
  afterEach(async () => {
    await truncateAll(tdb.db);
  });
  afterAll(async () => {
    await tdb.close();
  });

  it("enqueues one og.generate job per key when the card is missing, and dedupes", async () => {
    const first = await ensureOg(db, { kind: "product", id: 999 });
    expect(first).toEqual({ key: "og/p/999.jpg", exists: false });
    await ensureOg(db, { kind: "product", id: 999 }); // second call dedupes by uniqueKey
    const rows = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.uniqueKey, "og/p/999.jpg"));
    expect(rows).toHaveLength(1);
  });

  it("reports exists=true and enqueues nothing once the media row is present", async () => {
    await db.insert(media).values({ id: ulid(), kind: "image", storageKey: "og/p/500.jpg", mime: "image/jpeg", bytes: 10, alt: "x", source: "seed" });
    const r = await ensureOg(db, { kind: "product", id: 500 });
    expect(r.exists).toBe(true);
    const rows = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.uniqueKey, "og/p/500.jpg"));
    expect(rows).toHaveLength(0);
  });
});
