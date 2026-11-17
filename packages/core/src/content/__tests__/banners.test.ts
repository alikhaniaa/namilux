import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { banners as bannersTable } from "@namilux/db";
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

// vi.hoisted so the spy is a standalone function: reading `jobs.enqueue` back out of the mocked
// module would be an unbound method reference (eslint @typescript-eslint/unbound-method).
const { enqueue } = vi.hoisted(() => ({
  // the signature mirrors jobs.enqueue so `enqueue.mock.calls` keeps its argument types
  enqueue: vi.fn(
    async (
      _db: unknown,
      _type: string,
      _payload: Record<string, unknown>,
      _opts?: { runAt?: Date; uniqueKey?: string },
    ) => "01JOB",
  ),
}));
vi.mock("../../jobs", () => ({ backoffMinutes: () => 1, jobs: { enqueue } }));

import {
  SLOT_MEDIA_REQUIRED,
  getBanners,
  isLive,
  nextBoundary,
  pickForTarget,
  upsertBanner,
} from "../banners";
import type { Banner, BannerInput, BannerTargeting } from "../banners";
import type { BannerSlot } from "../../constants";

/** Validation happens before the first statement, so these cases never touch a connection. */
const noDb = {} as unknown as Db;

const T0 = new Date("2026-08-01T00:00:00.000Z");
// Boundaries are relative to the clock: a fixed calendar date silently turns into "already
// passed" once the calendar moves on (this happened on 1 Sep 2026), and only one flip job is
// scheduled for a window whose start is behind us.
const DAY_MS = 86_400_000;
const T1 = new Date(Math.ceil(Date.now() / DAY_MS) * DAY_MS + 7 * DAY_MS);
const T2 = new Date(T1.getTime() + 30 * DAY_MS);

type Over = Partial<Omit<BannerInput, "slot" | "title">>;
const input = (slot: BannerSlot, title: string, over: Over = {}): BannerInput => ({
  slot,
  title,
  theme: "auto",
  isActive: true,
  sort: 0,
  ...over,
});

const banner = (over: Partial<Banner> = {}): Banner => ({
  id: 1,
  slot: "home_hero",
  title: "عنوان",
  subtitle: null,
  ctaLabel: null,
  ctaHref: null,
  mediaLight: null,
  mediaDark: null,
  theme: "auto",
  startsAt: null,
  endsAt: null,
  isActive: true,
  sort: 0,
  targeting: null,
  ...over,
});

describe("isLive - live window table", () => {
  const at = T1;
  const table: [string, string | null, string | null, boolean, boolean][] = [
    // label, startsAt, endsAt, isActive, expected
    ["both null → always live", null, null, true, true],
    ["inactive is never live", null, null, false, false],
    ["startsAt exactly at → live", T1.toISOString(), null, true, true],
    ["endsAt exactly at → not live (half-open)", null, T1.toISOString(), true, false],
    ["inside the window", T0.toISOString(), T2.toISOString(), true, true],
    ["before the window", T2.toISOString(), null, true, false],
    ["after the window", T0.toISOString(), T0.toISOString(), true, false],
    ["open start, future end", null, T2.toISOString(), true, true],
    ["unparseable boundary → not live", "tomorrow", null, true, false],
  ];

  it.each(table)("%s", (_label, startsAt, endsAt, isActive, expected) => {
    expect(isLive({ isActive, startsAt, endsAt }, at)).toBe(expected);
  });
});

describe("nextBoundary", () => {
  it("returns the earliest strictly future boundary", () => {
    const found = nextBoundary(
      [
        { startsAt: T0.toISOString(), endsAt: T2.toISOString() },
        { startsAt: null, endsAt: T1.toISOString() },
      ],
      T0,
    );
    expect(found?.toISOString()).toBe(T1.toISOString());
  });

  it("returns null when every window is in the past", () => {
    expect(nextBoundary([{ startsAt: T0.toISOString(), endsAt: T1.toISOString() }], T2)).toBeNull();
    expect(nextBoundary([], T0)).toBeNull();
    expect(nextBoundary([{ startsAt: null, endsAt: null }], T0)).toBeNull();
  });

  it("ignores a boundary that is exactly `at`", () => {
    expect(nextBoundary([{ startsAt: null, endsAt: T1.toISOString() }], T1)).toBeNull();
  });
});

describe("pickForTarget - table", () => {
  const none = banner({ id: 1, targeting: null });
  const smeg = banner({ id: 2, targeting: { brandSlug: "smeg" } });
  const coffee = banner({ id: 3, targeting: { collectionSlug: "coffee" } });
  const both = banner({ id: 4, targeting: { brandSlug: "smeg", collectionSlug: "coffee" } });
  const all = [none, smeg, coffee, both];

  const ids = (target: BannerTargeting): number[] => pickForTarget(all, target).map((b) => b.id);

  it("targeting null matches every target", () => {
    expect(ids({})).toEqual([1]);
  });

  it("a set key must equal the target's", () => {
    expect(ids({ brandSlug: "smeg" })).toEqual([1, 2]);
    expect(ids({ brandSlug: "dyson" })).toEqual([1]);
    expect(ids({ collectionSlug: "coffee" })).toEqual([1, 3]);
    expect(ids({ brandSlug: "smeg", collectionSlug: "coffee" })).toEqual([1, 2, 3, 4]);
    expect(ids({ brandSlug: "dyson", collectionSlug: "coffee" })).toEqual([1, 3]);
  });
});

describe("upsertBanner - copy and slot rules (no statement is sent)", () => {
  it("promo bar requires endsAt", async () => {
    await expect(upsertBanner(noDb, input("promo_bar", "ارسال رایگان تا پایان هفته"), {
      type: "staff",
      id: null,
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("promo bar copy is ≤ 70 chars, Persian digits, no exclamation", async () => {
    const actor = { type: "staff", id: null } as const;
    const ends = { endsAt: T2.toISOString() };
    await expect(
      upsertBanner(noDb, input("promo_bar", "آ".repeat(71), ends), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      upsertBanner(noDb, input("promo_bar", "ارسال رایگان!", ends), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      upsertBanner(noDb, input("promo_bar", "تخفیف 20 درصدی", ends), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("media required per slot", async () => {
    const actor = { type: "staff", id: null } as const;
    expect(SLOT_MEDIA_REQUIRED).toEqual({
      promo_bar: false,
      home_hero: true,
      home_band: true,
      category_tile: true,
      plp_inline: true,
      pdp_band: true,
      ig_landing: true,
    });
    for (const slot of Object.keys(SLOT_MEDIA_REQUIRED) as BannerSlot[]) {
      if (!SLOT_MEDIA_REQUIRED[slot]) continue;
      await expect(upsertBanner(noDb, input(slot, "عنوان"), actor)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    // EDGE CASE: promo_bar carries no media at all
    await expect(
      upsertBanner(
        noDb,
        input("promo_bar", "پیام", { endsAt: T2.toISOString(), mediaLightId: `01H${"Z".repeat(23)}` }),
        actor,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("cta href hygiene", async () => {
    const actor = { type: "staff", id: null } as const;
    const base: Over = { endsAt: T2.toISOString(), ctaLabel: "مشاهده" };
    await expect(
      upsertBanner(noDb, input("promo_bar", "پیام", { ...base, ctaHref: "javascript:alert(1)" }), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      upsertBanner(noDb, input("promo_bar", "پیام", { ...base, ctaHref: "//evil.example" }), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // a label without a target (and a target without a label) is a dead button
    await expect(
      upsertBanner(noDb, input("promo_bar", "پیام", base), actor),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects an inverted window", async () => {
    await expect(
      upsertBanner(
        noDb,
        input("promo_bar", "پیام", { startsAt: T2.toISOString(), endsAt: T1.toISOString() }),
        { type: "staff", id: null },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe.skipIf(!hasTestDb())("banners against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  beforeEach(() => {
    enqueue.mockClear();
  });

  it("sort order - live only, sort asc then id asc", async () => {
    await withTestTx(handle.db, async (tx) => {
      const rows = [
        { slot: "home_hero" as const, title: "دوم", sort: 1 },
        { slot: "home_hero" as const, title: "اول", sort: 0 },
        { slot: "home_hero" as const, title: "سوم", sort: 1 },
        { slot: "home_hero" as const, title: "غیرفعال", sort: 0, isActive: false },
        { slot: "home_hero" as const, title: "تمام‌شده", sort: 0, endsAt: T0 },
        { slot: "home_hero" as const, title: "آینده", sort: 0, startsAt: T2 },
        { slot: "promo_bar" as const, title: "سلات دیگر", sort: 0 },
      ];
      for (const row of rows) await tx.insert(bannersTable).values(row);

      const live = await getBanners(tx, "home_hero", T1);
      expect(live.map((b) => b.title)).toEqual(["اول", "دوم", "سوم"]);
      // EDGE CASE: two live heroes → both returned; home.ts picks the first.
      expect(live.filter((b) => b.sort === 1)).toHaveLength(2);
      expect(await getBanners(tx, "pdp_band", T1)).toEqual([]);
    });
  });

  it("drops a stored CTA whose href is unsafe", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(bannersTable).values({
        slot: "pdp_band",
        title: "بنر",
        ctaLabel: "مشاهده",
        ctaHref: "javascript:alert(1)",
      });
      const [live] = await getBanners(tx, "pdp_band", T1);
      expect(live?.ctaHref).toBeNull();
      expect(live?.ctaLabel).toBeNull();
    });
  });

  it("upsert schedules flip jobs at both boundaries", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { id, tags } = await upsertBanner(
        tx,
        input("promo_bar", "ارسال رایگان تا پایان هفته", {
          startsAt: T1.toISOString(),
          endsAt: T2.toISOString(),
        }),
        { type: "staff", id: null },
      );

      expect(id).toBeGreaterThan(0);
      expect(tags).toEqual(["content", "home"]);
      expect(enqueue).toHaveBeenCalledTimes(2);
      const keys = enqueue.mock.calls.map((call) => call[3]?.uniqueKey);
      expect(keys).toEqual([`banner:${id}:start`, `banner:${id}:end`]);
      expect(enqueue.mock.calls[0]?.[1]).toBe("cache.revalidate");
      expect(enqueue.mock.calls[0]?.[3]?.runAt?.toISOString()).toBe(T1.toISOString());

      // the row is live between the boundaries and invisible outside them
      expect(await getBanners(tx, "promo_bar", T0)).toEqual([]);
      expect((await getBanners(tx, "promo_bar", T1)).map((b) => b.id)).toEqual([id]);
      expect(await getBanners(tx, "promo_bar", T2)).toEqual([]);
    });
  });

  it("does not enqueue a job for a boundary that already passed", async () => {
    await withTestTx(handle.db, async (tx) => {
      await upsertBanner(
        tx,
        input("promo_bar", "پیام گذشته", { startsAt: T0.toISOString(), endsAt: T1.toISOString() }),
        { type: "staff", id: null },
      );
      const runAts = enqueue.mock.calls.map((call) => call[3]?.runAt?.getTime() ?? 0);
      for (const ms of runAts) expect(ms).toBeGreaterThan(Date.now());
    });
  });

  it("rejects an unknown media id and an unknown targeting slug", async () => {
    await withTestTx(handle.db, async (tx) => {
      await expect(
        upsertBanner(tx, input("home_hero", "قهرمان", { mediaLightId: `01H${"Z".repeat(23)}` }), {
          type: "staff",
          id: null,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });

      await expect(
        upsertBanner(
          tx,
          input("promo_bar", "پیام", {
            endsAt: T2.toISOString(),
            targeting: { brandSlug: "does-not-exist" },
          }),
          { type: "staff", id: null },
        ),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
