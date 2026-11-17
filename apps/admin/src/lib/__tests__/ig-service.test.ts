import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ulid } from "@namilux/core";
import { auditLog, banners, eq, media, sql } from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { IG_LOCK_KEY, listIgCards, replaceIgCards } from "../ig-service";
import type { IgCardInput } from "../ig-service";

const ACTOR = { type: "staff" as const, id: null };
const DAY_MS = 86_400_000;

const card = (title: string, mediaLightId: string, over: Partial<IgCardInput> = {}): IgCardInput => ({
  slot: "ig_landing",
  title,
  mediaLightId,
  theme: "auto",
  isActive: true,
  ...over,
});

/** The duplicate and wrong-slot checks run before the transaction opens, so no connection is needed. */
const noDb = {} as unknown as Db;

describe("replaceIgCards - refusals before any write", () => {
  it("refuses the same id twice and names both cards", async () => {
    const m = ulid();
    await expect(replaceIgCards(noDb, [card("الف", m, { id: 7 }), card("ب", m), card("ج", m, { id: 7 })], ACTOR)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { card: 2, field: "id", reason: "duplicate_id", id: 7 },
      fa: expect.stringContaining("۱") as unknown,
    });
  });

  it("refuses a card that claims another slot", async () => {
    await expect(replaceIgCards(noDb, [card("الف", ulid(), { slot: "home_hero" })], ACTOR)).rejects.toMatchObject({
      code: "VALIDATION",
      details: { card: 0, reason: "wrong_slot" },
    });
  });
});

describe.skipIf(!hasTestDb())("replaceIgCards against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  async function image(tx: DbTx): Promise<string> {
    const id = ulid();
    await tx.insert(media).values({ id, kind: "image", storageKey: `k/${id}`, mime: "image/webp", bytes: 1, source: "admin" });
    return id;
  }

  async function slotRows(tx: DbTx) {
    return (await tx.select().from(banners).where(eq(banners.slot, "ig_landing"))).sort((a, b) => a.sort - b.sort || a.id - b.id);
  }

  async function foreignBanner(tx: DbTx, mediaId: string) {
    const [row] = await tx.insert(banners).values({ slot: "home_hero", title: "قهرمان خانه", mediaLightId: mediaId, sort: 0 }).returning();
    if (row === undefined) throw new Error("seed failed");
    return row;
  }

  it("removes, reorders and edits in one save, and leaves other slots alone", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const hero = await foreignBanner(tx, m);
      const first = await replaceIgCards(tx, [card("یک", m), card("دو", m), card("سه", m)], ACTOR);
      expect(first.ids).toHaveLength(3);
      expect(first.removed).toEqual([]);
      const [a, b, c] = first.ids as [number, number, number];

      const second = await replaceIgCards(tx, [card("سهٔ تازه", m, { id: c }), card("یک", m, { id: a })], ACTOR);
      expect(second.ids).toEqual([c, a]);
      expect(second.removed).toEqual([b]);
      expect(second.revalidate.length).toBeGreaterThan(0);

      const rows = await slotRows(tx);
      expect(rows.map((r) => [r.id, r.title, r.sort])).toEqual([
        [c, "سهٔ تازه", 0],
        [a, "یک", 1],
      ]);

      const [heroAfter] = await tx.select().from(banners).where(eq(banners.id, hero.id));
      expect(heroAfter).toEqual(hero);

      const deletes = await tx.select().from(auditLog).where(eq(auditLog.entityId, String(b)));
      expect(deletes.map((r) => r.action)).toContain("banner.delete");
    });
  });

  it("saving the returned ids again creates nothing new", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const list = [card("یک", m), card("دو", m)];
      const { ids } = await replaceIgCards(tx, list, ACTOR);
      const again = await replaceIgCards(tx, list.map((c, i) => ({ ...c, id: ids[i] })), ACTOR);
      expect(again.ids).toEqual(ids);
      expect(again.removed).toEqual([]);
      expect((await slotRows(tx)).map((r) => r.id)).toEqual(ids);
    });
  });

  it("an empty list empties the slot", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const { ids } = await replaceIgCards(tx, [card("یک", m), card("دو", m)], ACTOR);
      const r = await replaceIgCards(tx, [], ACTOR);
      expect([...r.removed].sort((x, y) => x - y)).toEqual([...ids].sort((x, y) => x - y));
      expect(await slotRows(tx)).toEqual([]);
    });
  });

  it("refuses a banner from another slot without moving it or touching the page", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const hero = await foreignBanner(tx, m);
      const { ids } = await replaceIgCards(tx, [card("یک", m), card("دو", m)], ACTOR);
      const before = await slotRows(tx);

      await expect(replaceIgCards(tx, [card("یک", m, { id: ids[0] }), card("دزدیده", m, { id: hero.id })], ACTOR)).rejects.toMatchObject({
        code: "VALIDATION",
        details: { card: 1, reason: "foreign_slot", id: hero.id },
      });

      const [heroAfter] = await tx.select().from(banners).where(eq(banners.id, hero.id));
      expect(heroAfter).toEqual(hero);
      expect(await slotRows(tx)).toEqual(before);
    });
  });

  it("refuses an id that no longer exists", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      await expect(replaceIgCards(tx, [card("یک", m, { id: 2_000_000_000 })], ACTOR)).rejects.toMatchObject({
        code: "VALIDATION",
        details: { card: 0, reason: "unknown_id" },
      });
    });
  });

  it("rolls the whole save back when one card is refused mid-way", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const { ids } = await replaceIgCards(tx, [card("یک", m), card("دو", m)], ACTOR);
      const before = await slotRows(tx);

      // card 0 is edited, card 1 (id ids[1]) is dropped, card 1 of the new list points at no media:
      // none of it may land.
      await expect(replaceIgCards(tx, [card("یکِ عوض‌شده", m, { id: ids[0] }), card("تازه", ulid())], ACTOR)).rejects.toMatchObject({
        code: "VALIDATION",
        details: { card: 1 },
        fa: expect.stringContaining("کارت شمارهٔ ۲") as unknown,
      });
      expect(await slotRows(tx)).toEqual(before);
    });
  });

  it("holds the slot lock until the save's transaction ends, even on an empty slot", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      await tx.delete(banners).where(eq(banners.slot, "ig_landing"));
      await replaceIgCards(tx, [card("اولین", m)], ACTOR);
      // A second connection (the pool holds more than one) cannot take the lock while this
      // transaction is open, so a concurrent first save would wait instead of inserting beside it.
      const [probe] = await handle.db.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${IG_LOCK_KEY})) as got`);
      expect(probe?.got).toBe(false);
    });
    const [after] = await handle.db.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${IG_LOCK_KEY})) as got`);
    expect(after?.got).toBe(true);
  });

  it("lists inactive and scheduled cards for the editor", async () => {
    await withTestTx(handle.db, async (tx) => {
      const m = await image(tx);
      const later = new Date(Date.now() + 7 * DAY_MS).toISOString();
      await replaceIgCards(tx, [card("فعال", m), card("خاموش", m, { isActive: false }), card("زمان‌دار", m, { startsAt: later })], ACTOR);
      const listed = await listIgCards(tx);
      expect(listed.map((c) => [c.title, c.isActive, c.mediaLightId])).toEqual([
        ["فعال", true, m],
        ["خاموش", false, m],
        ["زمان‌دار", true, m],
      ]);
      expect(listed[2]?.startsAt).toBe(later);
    });
  });
});
