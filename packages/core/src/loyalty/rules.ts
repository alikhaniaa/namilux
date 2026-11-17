import { z } from "zod";

export type Tier = "member" | "silver" | "gold" | "diamond";

export const TIER_ORDER: readonly Tier[] = ["member", "silver", "gold", "diamond"];

export const TIER_FA: Record<Tier, string> = {
  member: "عضو",
  silver: "نقره‌ای",
  gold: "طلایی",
  diamond: "الماس",
};

const tierSchema = z.enum(["member", "silver", "gold", "diamond"]);

export const loyaltyRulesSchema = z
  .object({
    enabled: z.boolean(),
    earnPerToman: z.number().int().min(1),
    pointValueToman: z.number().int().min(1),
    maxRedeemPercent: z.number().int().min(0).max(100),
    minRedeem: z.number().int().min(0),
    expiryMonths: z.number().int().min(1),
    tierThresholds: z
      .object({
        silver: z.number().int().min(0),
        gold: z.number().int().min(0),
        diamond: z.number().int().min(0),
      })
      .strict()
      .refine((t) => t.silver <= t.gold && t.gold <= t.diamond, {
        message: "tier thresholds must be monotonic: silver ≤ gold ≤ diamond",
      }),
    benefits: z
      .object({
        birthdayCoupon: z
          .object({
            enabled: z.boolean(),
            minTier: tierSchema,
            percent: z.number().int().min(1).max(100),
            maxDiscount: z.number().int().min(0).nullable(),
            validDays: z.number().int().min(1),
          })
          .strict(),
        earlyAccess: z
          .object({ enabled: z.boolean(), minTier: tierSchema, hours: z.number().int().min(1) })
          .strict(),
        freeExpressTehran: z.object({ enabled: z.boolean(), minTier: tierSchema }).strict(),
        priorityWhatsapp: z.object({ enabled: z.boolean(), minTier: tierSchema }).strict(),
        reviewBonus: z.object({ enabled: z.boolean(), points: z.number().int().min(0) }).strict(),
      })
      .strict(),
    referral: z
      .object({
        enabled: z.boolean(),
        referrerPoints: z.number().int().min(0),
        refereeCouponPercent: z.number().int().min(0).max(100),
      })
      .strict(),
  })
  .strict();

// DECISION (M0 step 3): LoyaltyRules is inferred from loyaltyRulesSchema, which the spec and
// ../types/customer.ts both name as the source of truth for settings key "loyalty.rules";
// ../types/customer.ts now re-exports THIS declaration instead of hand-mirroring a drifted copy.
export type LoyaltyRules = z.infer<typeof loyaltyRulesSchema>;

export const DEFAULT_LOYALTY_RULES: LoyaltyRules = {
  enabled: true,
  earnPerToman: 10_000,
  pointValueToman: 1_000,
  maxRedeemPercent: 20,
  minRedeem: 100,
  expiryMonths: 12,
  tierThresholds: {
    silver: 50_000_000,
    gold: 200_000_000,
    diamond: 500_000_000,
  },
  benefits: {
    birthdayCoupon: { enabled: true, minTier: "silver", percent: 10, maxDiscount: null, validDays: 30 },
    earlyAccess: { enabled: true, minTier: "gold", hours: 24 },
    freeExpressTehran: { enabled: true, minTier: "gold" },
    priorityWhatsapp: { enabled: true, minTier: "diamond" },
    reviewBonus: { enabled: true, points: 50 },
  },
  referral: { enabled: false, referrerPoints: 500, refereeCouponPercent: 5 },
};

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}
