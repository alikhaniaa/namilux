import { z } from "zod";
import {
  BANNER_SLOTS,
  BANNER_THEMES,
  COUPON_CODE_MAX_LEN,
  COUPON_CODE_MIN_LEN,
  COUPON_KINDS,
  CUSTOMER_TIERS,
  UNAMBIGUOUS_ALPHABET,
} from "../constants";
import {
  cleanFold,
  zBool,
  zHref,
  zId,
  zInt,
  zIsoDateTime,
  zLatinSlug,
  zMultiline,
  zSort,
  zText,
  zTomanInput,
  zUlid,
  FA,
} from "./common";

export const couponCodeAdminSchema = z.preprocess(
  (v) => {
    const c = cleanFold(v);
    return typeof c === "string" ? c.toUpperCase() : c;
  },
  z.string().regex(new RegExp(`^[${UNAMBIGUOUS_ALPHABET}]{${COUPON_CODE_MIN_LEN},${COUPON_CODE_MAX_LEN}}$`), FA.invalid),
);

export const couponScopeSchema = z
  .object({
    brandIds: z.array(zId).max(200).optional(),
    categoryIds: z.array(zId).max(200).optional(),
    collectionIds: z.array(zId).max(200).optional(),
    productIds: z.array(zId).max(200).optional(),
  })
  .strict();

export const couponAdminSchema = z
  .object({
    id: zId.optional(),
    code: couponCodeAdminSchema,
    kind: z.enum(COUPON_KINDS),
    value: zTomanInput,
    minSubtotal: zTomanInput.default(0),
    maxDiscount: zTomanInput.nullable().optional(),
    startsAt: zIsoDateTime.nullable().optional(),
    endsAt: zIsoDateTime.nullable().optional(),
    usageLimit: zInt(1, 1_000_000).nullable().optional(),
    usagePerCustomer: zInt(1, 100).default(1),
    firstOrderOnly: zBool.default(false),
    customerId: zUlid.nullable().optional(),
    applies: couponScopeSchema.default({}),
    excludes: couponScopeSchema.default({}),
    stackableWithPoints: zBool.default(true),
    isActive: zBool.default(true),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.kind === "percent" && (c.value < 1 || c.value > 100)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: FA.invalid });
    }
    if (c.kind === "fixed" && c.value < 1000) {
      ctx.addIssue({ code: "custom", path: ["value"], message: FA.invalid });
    }
    if (c.kind === "free_shipping" && (c.value !== 0 || c.maxDiscount != null)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: FA.invalid });
    }
    if (c.startsAt && c.endsAt && !(c.endsAt > c.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: FA.invalid });
    }
  });

const MEDIA_SLOTS = new Set<string>(["home_hero", "home_band", "pdp_band", "category_tile", "ig_landing"]);

export const bannerSchema = z
  .object({
    id: zId.optional(),
    slot: z.enum(BANNER_SLOTS),
    title: zText(120, 1),
    subtitle: zText(200).nullable().optional(),
    ctaLabel: zText(40).nullable().optional(),
    ctaHref: zHref.nullable().optional(),
    mediaLightId: zUlid.nullable().optional(),
    mediaDarkId: zUlid.nullable().optional(),
    theme: z.enum(BANNER_THEMES).default("auto"),
    startsAt: zIsoDateTime.nullable().optional(),
    endsAt: zIsoDateTime.nullable().optional(),
    isActive: zBool.default(true),
    sort: zSort,
    targeting: z
      .object({
        collectionSlug: zLatinSlug.optional(),
        brandSlug: zLatinSlug.optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (MEDIA_SLOTS.has(b.slot) && !b.mediaLightId) {
      ctx.addIssue({ code: "custom", path: ["mediaLightId"], message: FA.required });
    }
    if (b.slot === "promo_bar" && (b.title.length > 80 || b.mediaLightId || b.mediaDarkId)) {
      ctx.addIssue({ code: "custom", path: ["title"], message: FA.invalid });
    }
    if (Boolean(b.ctaLabel) !== Boolean(b.ctaHref)) {
      ctx.addIssue({ code: "custom", path: ["ctaHref"], message: FA.required });
    }
    if (b.startsAt && b.endsAt && !(b.endsAt > b.startsAt)) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: FA.invalid });
    }
  });

export const smsSegmentSchema = z
  .object({
    tiers: z.array(z.enum(CUSTOMER_TIERS)).max(4).optional(),
    lastOrderWithinDays: zInt(1, 730).optional(),
    brandIds: z.array(zId).max(20).optional(),
    optInOnly: z.literal(true).default(true),
  })
  .strict();

export const smsCampaignSchema = z
  .object({
    name: zText(80, 1),
    segment: smsSegmentSchema,
    text: zText(300, 5),
    budgetToman: zTomanInput,
    dryRun: zBool.default(true),
  })
  .strict();

export const loyaltyAdjustSchema = z
  .object({
    delta: zInt(-1_000_000, 1_000_000).refine((d) => d !== 0, FA.invalid),
    note: zText(200, 3),
  })
  .strict();

export const customerBlockSchema = z
  .object({
    blocked: zBool,
    reason: zText(200).optional(),
  })
  .strict()
  .refine((b) => !b.blocked || Boolean(b.reason), { message: FA.required, path: ["reason"] });

export const customerNoteSchema = z.object({ note: zMultiline(2000).nullable() }).strict();
export const customerTagsSchema = z.object({ tags: z.array(zText(30, 1)).max(20, FA.tooLong) }).strict();

export type CouponAdminInput = z.infer<typeof couponAdminSchema>;
export type CouponScopeInput = z.infer<typeof couponScopeSchema>;
export type BannerInput = z.infer<typeof bannerSchema>;
export type SmsSegmentInput = z.infer<typeof smsSegmentSchema>;
export type SmsCampaignInput = z.infer<typeof smsCampaignSchema>;
export type LoyaltyAdjustInput = z.infer<typeof loyaltyAdjustSchema>;
export type CustomerBlockInput = z.infer<typeof customerBlockSchema>;
