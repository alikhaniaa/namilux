import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asc, banners as bannersTable, eq, settings as settingsTable, sql } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));
vi.mock("../../jobs", () => ({ backoffMinutes: () => 1, jobs: { enqueue: vi.fn(async () => "01JOB") } }));

import { getAllBanners, getBanners, upsertBanner } from "../banners";
import type { BannerInput } from "../banners";
import { isSafeHref } from "../menus";
import { PROMO_LOCK_KEY, replacePromoBar } from "../promo";
import {
  promoFaultFa,
  promoHrefFault,
  promoMessageState,
  promoTitleFault,
  validatePromoDraft,
} from "../promo-copy";

const DAY = 86_400_000;
const future = (days: number): string => new Date(Math.ceil(Date.now() / DAY) * DAY + days * DAY).toISOString();
const staff = { type: "staff" as const, id: null };
const noDb = {} as unknown as Db;

const msg = (title: string, over: Partial<BannerInput> = {}): BannerInput => ({
  slot: "promo_bar",
  title,
  theme: "auto",
  isActive: true,
  sort: 0,
  endsAt: future(30),
  ...over,
});

// ---------------------------------------------------------------- the pure mirror

describe("promo-copy mirrors the write path", () => {
  it.each([
    ["ارسال رایگان تا پایان هفته", null],
    ["", "required"],
    ["   ", "required"],
    ["تخفیف ویژه!", "exclamation"],
    ["تخفیف ۲۰ درصد", null],
    ["تخفیف 20 درصد", "latin_digit"],
    ["ا".repeat(70), null],
    ["ا".repeat(71), "too_long"],
  ])("title %j → %s, and upsertBanner agrees", async (title, fault) => {
    expect(promoTitleFault(title)).toBe(fault);
    const call = upsertBanner(noDb, msg(title), staff);
    if (fault === null) {
      // reaches the database (which noDb is not) - i.e. the copy passed
      await expect(call).rejects.not.toMatchObject({ code: "VALIDATION" });
    } else {
      await expect(call).rejects.toMatchObject({ code: "VALIDATION", details: { field: "title", reason: fault } });
    }
  });

  it.each(["/c/oven", "https://namilux.ir/x", "//evil.com", "javascript:alert(1)", "http://x.ir", "/a b", "/a/../b", "https:///x", "/a\\b"])(
    "href %j matches isSafeHref",
    (href) => {
      expect(promoHrefFault(href) === null).toBe(isSafeHref(href));
    },
  );

  it("names each broken field of a draft in Persian", () => {
    const errors = validatePromoDraft(
      [
        { title: "پیام درست", ctaLabel: null, ctaHref: null, startsAt: null, endsAt: future(3) },
        { title: "", ctaLabel: "مشاهده", ctaHref: null, startsAt: null, endsAt: null },
        { title: "پیام", ctaLabel: null, ctaHref: "javascript:x", startsAt: future(5), endsAt: future(4) },
      ],
      3,
    );
    expect(Object.keys(errors).sort()).toEqual(
      [
        "messages.1.ctaHref",
        "messages.1.endsAt",
        "messages.1.title",
        "messages.2.ctaHref",
        "messages.2.ctaLabel",
        "messages.2.endsAt",
        "settings.rotateSec",
      ].sort(),
    );
    expect(errors["messages.1.endsAt"]).toBe(promoFaultFa("endsAt", "required"));
    expect(errors["messages.2.endsAt"]).toBe(promoFaultFa("endsAt", "invalid_window"));
    for (const text of Object.values(errors)) {
      expect(text).not.toMatch(/[!！]/);
      expect(text).not.toMatch(/[0-9]/);
    }
  });

  it("reads each message's storefront state with the isLive window", () => {
    const at = new Date(future(10));
    expect(promoMessageState({ isActive: false, startsAt: null, endsAt: future(20) }, at)).toBe("off");
    expect(promoMessageState({ isActive: true, startsAt: future(15), endsAt: future(20) }, at)).toBe("scheduled");
    expect(promoMessageState({ isActive: true, startsAt: null, endsAt: future(20) }, at)).toBe("live");
    expect(promoMessageState({ isActive: true, startsAt: null, endsAt: future(10) }, at)).toBe("expired");
  });
});

describe("replacePromoBar - refused before the transaction opens", () => {
  it("a message aimed at another slot", async () => {
    await expect(
      replacePromoBar(noDb, { messages: [msg("پیام", { slot: "home_hero" })], settings: { enabled: true, rotateSec: 8 } }, staff),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { field: "messages.0.slot", reason: "slot_mismatch" } });
  });

  it("the same id twice, too many messages, rotation out of range", async () => {
    await expect(
      replacePromoBar(noDb, { messages: [msg("الف", { id: 4 }), msg("ب", { id: 4 })], settings: { enabled: true, rotateSec: 8 } }, staff),
    ).rejects.toMatchObject({ details: { field: "messages.1.id", reason: "duplicate" } });
    await expect(
      replacePromoBar(noDb, { messages: Array.from({ length: 21 }, () => msg("پیام")), settings: { enabled: true, rotateSec: 8 } }, staff),
    ).rejects.toMatchObject({ details: { field: "messages", reason: "too_many" } });
    await expect(replacePromoBar(noDb, { messages: [], settings: { enabled: true, rotateSec: 3 } }, staff)).rejects.toMatchObject({
      details: { field: "settings.rotateSec", reason: "out_of_range" },
    });
  });
});

// ---------------------------------------------------------------- against the database

describe.skipIf(!hasTestDb())("replacePromoBar against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  const promoRows = (tx: Db) =>
    tx
      .select({ id: bannersTable.id, title: bannersTable.title, sort: bannersTable.sort, isActive: bannersTable.isActive })
      .from(bannersTable)
      .where(eq(bannersTable.slot, "promo_bar"))
      .orderBy(asc(bannersTable.sort), asc(bannersTable.id));
  const heroRow = (tx: Db, id: number) =>
    tx.select().from(bannersTable).where(eq(bannersTable.id, id)).then((r) => r[0]);
  const promoSetting = (tx: Db) =>
    tx.select({ v: settingsTable.valueJson }).from(settingsTable).where(eq(settingsTable.key, "promo.bar")).then((r) => r[0]?.v);

  /** a clean slot plus one untouchable home_hero row (no media FK needed for a raw insert) */
  async function seed(tx: Db): Promise<{ heroId: number }> {
    await tx.delete(bannersTable).where(eq(bannersTable.slot, "promo_bar"));
    const [hero] = await tx.insert(bannersTable).values({ slot: "home_hero", title: "قهرمان", sort: 0 }).returning({ id: bannersTable.id });
    if (hero === undefined) throw new Error("seed: hero insert returned nothing");
    return { heroId: hero.id };
  }

  it("serializes first saves even when the slot is empty", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.delete(bannersTable).where(eq(bannersTable.slot, "promo_bar"));
      await replacePromoBar(tx, { messages: [msg("اول")], settings: { enabled: true, rotateSec: 8 } }, staff);
      const [blocked] = await handle.db.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${PROMO_LOCK_KEY})) as got`);
      expect(blocked?.got).toBe(false);
    });
    const [released] = await handle.db.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${PROMO_LOCK_KEY})) as got`);
    expect(released?.got).toBe(true);
  });

  it("create → update + reorder → remove, other slots untouched", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { heroId } = await seed(tx);
      const heroBefore = await heroRow(tx, heroId);

      // create three, one switched off and one scheduled for later
      const created = await replacePromoBar(
        tx,
        {
          messages: [msg("اول"), msg("دوم", { isActive: false }), msg("سوم", { startsAt: future(5), endsAt: future(9) })],
          settings: { enabled: true, rotateSec: 6 },
        },
        staff,
      );
      expect(created.ids).toHaveLength(3);
      expect(created.removed).toEqual([]);
      expect(created.tags).toEqual(expect.arrayContaining(["content", "home"]));
      const [a, b, c] = created.ids as [number, number, number];
      expect((await promoRows(tx)).map((r) => [r.id, r.title, r.sort])).toEqual([
        [a, "اول", 0],
        [b, "دوم", 1],
        [c, "سوم", 2],
      ]);
      expect(await promoSetting(tx)).toEqual({ enabled: true, rotateSec: 6 });

      // the admin read sees all three; the storefront read only the live one
      expect((await getAllBanners(tx, "promo_bar")).map((x) => x.id)).toEqual([a, b, c]);
      expect((await getBanners(tx, "promo_bar")).map((x) => x.id)).toEqual([a]);

      // update + reorder: c first, a renamed, b kept
      const updated = await replacePromoBar(
        tx,
        {
          messages: [msg("سوم", { id: c, startsAt: future(5), endsAt: future(9) }), msg("اول ویرایش‌شده", { id: a }), msg("دوم", { id: b, isActive: false })],
          settings: { enabled: false, rotateSec: 10 },
        },
        staff,
      );
      expect(updated.ids).toEqual([c, a, b]);
      expect((await promoRows(tx)).map((r) => [r.id, r.title, r.sort])).toEqual([
        [c, "سوم", 0],
        [a, "اول ویرایش‌شده", 1],
        [b, "دوم", 2],
      ]);
      expect(await promoSetting(tx)).toEqual({ enabled: false, rotateSec: 10 });

      // remove: only a survives, b and c (c still active) are deleted
      const removed = await replacePromoBar(tx, { messages: [msg("اول ویرایش‌شده", { id: a })], settings: { enabled: true, rotateSec: 10 } }, staff);
      expect(removed.removed.sort()).toEqual([b, c].sort());
      expect((await promoRows(tx)).map((r) => r.id)).toEqual([a]);

      // and an empty list clears the slot
      await replacePromoBar(tx, { messages: [], settings: { enabled: true, rotateSec: 10 } }, staff);
      expect(await promoRows(tx)).toEqual([]);

      // the hero row was never touched
      expect(await heroRow(tx, heroId)).toEqual(heroBefore);
    });
  });

  it("a rejected message writes nothing - no partial save of rows, deletions or the setting", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { heroId } = await seed(tx);
      const first = await replacePromoBar(tx, { messages: [msg("یک"), msg("دو")], settings: { enabled: true, rotateSec: 8 } }, staff);
      const [one, two] = first.ids as [number, number];
      const before = await promoRows(tx);
      const settingBefore = await promoSetting(tx);

      // message 0 would update, message 1 was removed, message 2 is new - and message 3 has no end
      await expect(
        replacePromoBar(
          tx,
          {
            messages: [msg("یک تغییرکرده", { id: one }), msg("تازه"), msg("بی‌پایان", { endsAt: null })],
            settings: { enabled: false, rotateSec: 20 },
          },
          staff,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        fa: expect.stringContaining("تاریخ پایان لازم است") as unknown,
        details: { field: "messages.2.endsAt", reason: "required", index: 2 },
      });
      expect(await promoRows(tx)).toEqual(before);
      expect(await promoSetting(tx)).toEqual(settingBefore);

      // an id from another slot is refused before any write, and the hero is not moved
      await expect(
        replacePromoBar(tx, { messages: [msg("ربودن", { id: heroId })], settings: { enabled: true, rotateSec: 8 } }, staff),
      ).rejects.toMatchObject({ code: "VALIDATION", details: { field: "messages.0.id", reason: "not_in_slot" } });
      expect((await heroRow(tx, heroId))?.slot).toBe("home_hero");
      expect(await promoRows(tx)).toEqual(before);

      // an unsafe href on the second message: the first message's change is rolled back too
      await expect(
        replacePromoBar(
          tx,
          { messages: [msg("یک دیگر", { id: one }), msg("دو", { id: two, ctaLabel: "مشاهده", ctaHref: "javascript:alert(1)" })], settings: { enabled: true, rotateSec: 8 } },
          staff,
        ),
      ).rejects.toMatchObject({ details: { field: "messages.1.ctaHref", reason: "unsafe_href" } });
      expect(await promoRows(tx)).toEqual(before);
    });
  });
});
