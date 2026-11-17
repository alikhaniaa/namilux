import { describe, expect, it } from "vitest";
import { BANNER_SLOTS, BANNER_THEMES, COUPON_KINDS, CUSTOMER_TIERS, UNAMBIGUOUS_ALPHABET } from "../../constants";
import {
  bannerSchema,
  couponAdminSchema,
  couponCodeAdminSchema,
  couponScopeSchema,
  customerBlockSchema,
  customerNoteSchema,
  customerTagsSchema,
  loyaltyAdjustSchema,
  smsCampaignSchema,
  smsSegmentSchema,
} from "../marketing";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
/** 8 characters, all inside UNAMBIGUOUS_ALPHABET (no 0/O/1/I/L). */
const CODE = "NAMYQ234";

describe("coupon code alphabet and kind rules", () => {
  it("folds, trims and uppercases a code of the unambiguous alphabet", () => {
    expect(couponCodeAdminSchema.parse(" namyq234 ")).toBe(CODE);
    expect(couponCodeAdminSchema.parse("NAMYQ۲۳۴")).toBe(CODE);
    expect(couponCodeAdminSchema.parse(UNAMBIGUOUS_ALPHABET.slice(0, 32))).toBe(UNAMBIGUOUS_ALPHABET.slice(0, 32));
  });

  it("rejects an ambiguous character, a short code and an over-long code", () => {
    // DECISION (M0 tests): the header's first EDGE CASE ("welcome10" → "WELCOME10") contradicts its
    // third ("WELCOME1" throws - 1 is not in the alphabet) and contradicts the spec, which the
    // implementation follows. The alphabet rule is asserted; the contradiction is logged in
    // the spec.
    for (const bad of ["welcome10", "WELCOME1", "NAMYQ23O", "NAMYQ23L", "NAMYQ23I", "ABCDEFG", "NAMY-234", "NAMY 234", "", `${CODE}${"2".repeat(25)}`]) {
      expect(() => couponCodeAdminSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    for (const ch of "0O1IL") {
      expect(() => couponCodeAdminSchema.parse(`NAMYQ23${ch}`), ch).toThrow();
    }
  });

  it("applies the per-kind value rule", () => {
    expect(couponAdminSchema.parse({ code: CODE, kind: "percent", value: 10 })).toMatchObject({
      code: CODE,
      kind: "percent",
      value: 10,
      minSubtotal: 0,
      usagePerCustomer: 1,
      firstOrderOnly: false,
      applies: {},
      excludes: {},
      stackableWithPoints: true,
      isActive: true,
    });
    expect(couponAdminSchema.parse({ code: CODE, kind: "percent", value: 100 }).value).toBe(100);
    expect(couponAdminSchema.parse({ code: CODE, kind: "fixed", value: 1000 }).value).toBe(1000);
    expect(couponAdminSchema.parse({ code: CODE, kind: "free_shipping", value: 0 }).value).toBe(0);
    for (const kind of COUPON_KINDS) expect(COUPON_KINDS).toContain(kind);

    const zero = couponAdminSchema.safeParse({ code: CODE, kind: "percent", value: 0 });
    expect(zero.success).toBe(false);
    expect(zero.error?.issues[0]?.path).toEqual(["value"]);
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "percent", value: 101 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "fixed", value: 500 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "free_shipping", value: 5 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "free_shipping", value: 0, maxDiscount: 100 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "gift", value: 1 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "percent", value: -10 })).toThrow();
    expect(() => couponAdminSchema.parse({ code: CODE, kind: "percent", value: 10, usedCount: 3 })).toThrow();
  });

  it("scopes are bounded id lists", () => {
    expect(couponScopeSchema.parse({})).toEqual({});
    expect(couponScopeSchema.parse({ brandIds: [1, 2], productIds: [3] })).toEqual({ brandIds: [1, 2], productIds: [3] });
    expect(() => couponScopeSchema.parse({ brandIds: Array.from({ length: 201 }, (_, i) => i + 1) })).toThrow();
    expect(() => couponScopeSchema.parse({ tagIds: [1] })).toThrow();
    expect(() => couponScopeSchema.parse({ brandIds: [0] })).toThrow();
    expect(
      couponAdminSchema.parse({ code: CODE, kind: "percent", value: 10, applies: { categoryIds: [7] } }).applies,
    ).toEqual({ categoryIds: [7] });
  });
});

describe("coupon window", () => {
  it("requires endsAt to be after startsAt", () => {
    const base = { code: CODE, kind: "percent" as const, value: 10 };
    expect(
      couponAdminSchema.parse({ ...base, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" }).endsAt,
    ).toBe("2026-02-01T00:00:00Z");
    const inverted = couponAdminSchema.safeParse({
      ...base,
      startsAt: "2026-02-01T00:00:00Z",
      endsAt: "2026-01-01T00:00:00Z",
    });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(["endsAt"]);
    expect(() =>
      couponAdminSchema.parse({ ...base, startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" }),
    ).toThrow();
    expect(couponAdminSchema.parse({ ...base, startsAt: null, endsAt: null }).endsAt).toBe(null);
    expect(() => couponAdminSchema.parse({ ...base, endsAt: "2026-01-01" })).toThrow();
    expect(couponAdminSchema.parse({ ...base, usageLimit: 100, customerId: ULID }).usageLimit).toBe(100);
    expect(() => couponAdminSchema.parse({ ...base, usageLimit: 0 })).toThrow();
    expect(() => couponAdminSchema.parse({ ...base, usagePerCustomer: 101 })).toThrow();
  });
});

describe("banner slot rules", () => {
  const base = { slot: "home_hero" as const, title: "کتری‌های اسمگ", sort: 0, mediaLightId: ULID };

  it("needs a light media for every image slot", () => {
    expect(bannerSchema.parse(base)).toMatchObject({ theme: "auto", isActive: true, sort: 0 });
    for (const theme of BANNER_THEMES) expect(bannerSchema.parse({ ...base, theme }).theme).toBe(theme);
    for (const slot of ["home_hero", "home_band", "pdp_band", "category_tile", "ig_landing"] as const) {
      expect(bannerSchema.parse({ ...base, slot }).slot).toBe(slot);
      const missing = bannerSchema.safeParse({ slot, title: "عنوان", sort: 0 });
      expect(missing.success, slot).toBe(false);
      expect(missing.error?.issues[0]?.path).toEqual(["mediaLightId"]);
    }
    expect(BANNER_SLOTS).toContain("plp_inline");
    expect(bannerSchema.parse({ slot: "plp_inline", title: "عنوان", sort: 0 }).mediaLightId).toBeUndefined();
  });

  it("promo_bar is text only and capped at eighty characters", () => {
    expect(bannerSchema.parse({ slot: "promo_bar", title: "ارسال رایگان به سراسر ایران", sort: 0 }).slot).toBe("promo_bar");
    expect(() => bannerSchema.parse({ slot: "promo_bar", title: "x".repeat(81), sort: 0 })).toThrow();
    expect(() => bannerSchema.parse({ slot: "promo_bar", title: "متن", sort: 0, mediaLightId: ULID })).toThrow();
    expect(() => bannerSchema.parse({ slot: "promo_bar", title: "متن", sort: 0, mediaDarkId: ULID })).toThrow();
  });

  it("pairs the cta label with the cta href and validates the window and targeting", () => {
    expect(bannerSchema.parse({ ...base, ctaLabel: "دیدن", ctaHref: "/shop/smeg/" }).ctaHref).toBe("/shop/smeg/");
    const half = bannerSchema.safeParse({ ...base, ctaLabel: "دیدن" });
    expect(half.success).toBe(false);
    expect(half.error?.issues[0]?.path).toEqual(["ctaHref"]);
    expect(() => bannerSchema.parse({ ...base, ctaHref: "/shop/" })).toThrow();
    expect(() => bannerSchema.parse({ ...base, ctaLabel: "دیدن", ctaHref: "javascript:alert(1)" })).toThrow();
    expect(() =>
      bannerSchema.parse({ ...base, startsAt: "2026-02-01T00:00:00Z", endsAt: "2026-01-01T00:00:00Z" }),
    ).toThrow();
    expect(bannerSchema.parse({ ...base, targeting: { collectionSlug: "gifts" } }).targeting).toEqual({
      collectionSlug: "gifts",
    });
    expect(() => bannerSchema.parse({ ...base, targeting: { collectionSlug: "Gifts" } })).toThrow();
    expect(() => bannerSchema.parse({ ...base, targeting: { productId: 1 } })).toThrow();
    expect(() => bannerSchema.parse({ ...base, slot: "footer" })).toThrow();
    expect(() => bannerSchema.parse({ ...base, clicks: 10 })).toThrow();
    expect(() => bannerSchema.parse({ ...base, title: "" })).toThrow();
  });
});

describe("sms campaign", () => {
  it("caps the text at 300 characters and only ever targets opted-in customers", () => {
    const segment = { tiers: ["gold", "diamond"] as const, lastOrderWithinDays: 180, optInOnly: true as const };
    expect(smsSegmentSchema.parse({})).toEqual({ optInOnly: true });
    expect(smsSegmentSchema.parse(segment)).toEqual({ ...segment, tiers: ["gold", "diamond"] });
    for (const tier of CUSTOMER_TIERS) expect(smsSegmentSchema.parse({ tiers: [tier] }).tiers).toEqual([tier]);
    expect(() => smsSegmentSchema.parse({ optInOnly: false })).toThrow();
    expect(() => smsSegmentSchema.parse({ tiers: ["platinum"] })).toThrow();
    expect(() => smsSegmentSchema.parse({ lastOrderWithinDays: 0 })).toThrow();
    expect(() => smsSegmentSchema.parse({ lastOrderWithinDays: 731 })).toThrow();
    expect(() => smsSegmentSchema.parse({ phones: ["09121230077"] })).toThrow();

    const campaign = { name: "نوروز", segment: { optInOnly: true as const }, text: "سلام، جشنوارهٔ نوروزی آغاز شد", budgetToman: 500_000 };
    expect(smsCampaignSchema.parse(campaign).dryRun).toBe(true);
    expect(smsCampaignSchema.parse({ ...campaign, dryRun: false }).dryRun).toBe(false);
    expect(() => smsCampaignSchema.parse({ ...campaign, text: "x".repeat(301) })).toThrow();
    expect(() => smsCampaignSchema.parse({ ...campaign, text: "کوتا" })).toThrow();
    expect(() => smsCampaignSchema.parse({ ...campaign, budgetToman: -1 })).toThrow();
    expect(() => smsCampaignSchema.parse({ ...campaign, name: "" })).toThrow();
    expect(() => smsCampaignSchema.parse({ ...campaign, sendAt: "2026-08-25T10:00:00.000Z" })).toThrow();
  });
});

describe("loyalty adjust", () => {
  it("refuses a zero delta and requires a note of at least three characters", () => {
    expect(loyaltyAdjustSchema.parse({ delta: "۵۰۰", note: "جبران خسارت" })).toEqual({ delta: 500, note: "جبران خسارت" });
    expect(loyaltyAdjustSchema.parse({ delta: -500, note: "اصلاح" }).delta).toBe(-500);
    expect(() => loyaltyAdjustSchema.parse({ delta: 0, note: "اصلاح" })).toThrow();
    expect(() => loyaltyAdjustSchema.parse({ delta: 500, note: "ok" })).toThrow();
    expect(() => loyaltyAdjustSchema.parse({ delta: 1_000_001, note: "اصلاح" })).toThrow();
    expect(() => loyaltyAdjustSchema.parse({ delta: 1.5, note: "اصلاح" })).toThrow();
    expect(() => loyaltyAdjustSchema.parse({ delta: 500 })).toThrow();
    expect(() => loyaltyAdjustSchema.parse({ delta: 500, note: "اصلاح", customerId: ULID })).toThrow();
  });
});

describe("customer block/note/tags", () => {
  it("blocking needs a reason, unblocking does not", () => {
    expect(customerBlockSchema.parse({ blocked: false })).toEqual({ blocked: false });
    expect(customerBlockSchema.parse({ blocked: true, reason: "سفارش‌های جعلی" }).reason).toBe("سفارش‌های جعلی");
    const noReason = customerBlockSchema.safeParse({ blocked: true });
    expect(noReason.success).toBe(false);
    expect(noReason.error?.issues[0]?.path).toEqual(["reason"]);
    expect(() => customerBlockSchema.parse({ blocked: "true" })).toThrow();
    expect(() => customerBlockSchema.parse({ blocked: true, reason: "x".repeat(201) })).toThrow();
  });

  it("notes may be cleared with null and tags are bounded", () => {
    expect(customerNoteSchema.parse({ note: null })).toEqual({ note: null });
    expect(customerNoteSchema.parse({ note: " مشتری وفادار " }).note).toBe("مشتری وفادار");
    expect(() => customerNoteSchema.parse({})).toThrow();
    expect(() => customerNoteSchema.parse({ note: "x".repeat(2001) })).toThrow();

    expect(customerTagsSchema.parse({ tags: ["وفادار", "عمده"] }).tags).toEqual(["وفادار", "عمده"]);
    expect(customerTagsSchema.parse({ tags: [] }).tags).toEqual([]);
    expect(() => customerTagsSchema.parse({ tags: [""] })).toThrow();
    expect(() => customerTagsSchema.parse({ tags: ["x".repeat(31)] })).toThrow();
    expect(() => customerTagsSchema.parse({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toThrow();
  });
});
