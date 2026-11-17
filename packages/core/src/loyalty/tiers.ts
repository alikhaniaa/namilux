import { type Db, customers } from "@namilux/db";
import { jobs } from "../jobs";
import { setTier, twelveMonthSpend } from "../customers/repo";
import type { TierInfo } from "../types";
import type { LoyaltyRules, Tier } from "./rules";

export type TierBenefits = { birthdayCoupon: boolean; earlySaleAccessHours: number; freeExpressTehran: boolean; priorityWhatsapp: boolean; reviewBonusPoints: number };

const TIER_ORDER: Tier[] = ["member", "silver", "gold", "diamond"];
function rank(t: Tier): number {
  return TIER_ORDER.indexOf(t);
}
function tierGE(t: Tier, min: Tier): boolean {
  return rank(t) >= rank(min);
}

export function tierForSpend(rules: LoyaltyRules, spend12m: number): Tier {
  const { silver, gold, diamond } = rules.tierThresholds;
  if (spend12m >= diamond) return "diamond";
  if (spend12m >= gold) return "gold";
  if (spend12m >= silver) return "silver";
  return "member";
}

export function benefitsFor(tier: Tier, rules: LoyaltyRules): TierBenefits {
  const b = rules.benefits;
  return {
    birthdayCoupon: b.birthdayCoupon.enabled && tierGE(tier, b.birthdayCoupon.minTier),
    earlySaleAccessHours: b.earlyAccess.enabled && tierGE(tier, b.earlyAccess.minTier) ? b.earlyAccess.hours : 0,
    freeExpressTehran: b.freeExpressTehran.enabled && tierGE(tier, b.freeExpressTehran.minTier),
    priorityWhatsapp: b.priorityWhatsapp.enabled && tierGE(tier, b.priorityWhatsapp.minTier),
    reviewBonusPoints: b.reviewBonus.enabled ? b.reviewBonus.points : 0,
  };
}

export function nextTier(tier: Tier, rules: LoyaltyRules, spend12m: number): { tier: Tier; remaining: number } | null {
  const idx = rank(tier);
  if (idx >= TIER_ORDER.length - 1) return null;
  const next = TIER_ORDER[idx + 1] as Exclude<Tier, "member">;
  const threshold = rules.tierThresholds[next];
  return { tier: next, remaining: Math.max(0, threshold - spend12m) };
}

export async function tierInfo(db: Db, customerId: string, rules: LoyaltyRules, now = new Date()): Promise<TierInfo> {
  const spend12m = await twelveMonthSpend(db, customerId, now);
  const tier = tierForSpend(rules, spend12m);
  const next = nextTier(tier, rules, spend12m);
  return {
    tier: tier,
    spend12m,
    nextTier: next === null ? null : (next.tier),
    toNextTier: next === null ? null : next.remaining,
  };
}

export async function recomputeTiers(db: Db, now: Date, rules: LoyaltyRules): Promise<{ upgraded: number; downgraded: number }> {
  const rows = await db.select({ id: customers.id, tier: customers.tier, phone: customers.phone }).from(customers);
  let upgraded = 0;
  let downgraded = 0;
  for (const c of rows) {
    const spend = await twelveMonthSpend(db, c.id, now);
    const target = tierForSpend(rules, spend);
    if (target === (c.tier)) continue;
    await setTier(db, c.id, target);
    if (rank(target) > rank(c.tier)) {
      upgraded += 1;
      // the spec: an upgrade is announced by SMS (template loyalty.tier_up); a downgrade is silent.
      await jobs.enqueue(db, "sms.send", { template: "loyalty.tier_up", customerId: c.id, phone: c.phone, tier: target }, { uniqueKey: `tier_up:${c.id}:${target}` });
    } else downgraded += 1;
  }
  return { upgraded, downgraded };
}

export async function grantBirthdayCoupons(db: Db, today: Date, rules: LoyaltyRules): Promise<number> {
  if (!rules.benefits.birthdayCoupon.enabled) return 0;
  const md = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rows = await db.select({ id: customers.id, tier: customers.tier, phone: customers.phone, birthday: customers.birthday }).from(customers);
  const min = rules.benefits.birthdayCoupon.minTier;
  let count = 0;
  for (const c of rows) {
    if (c.birthday === null || !tierGE(c.tier, min)) continue;
    if (String(c.birthday).slice(5, 10) !== md) continue;
    // Coupon creation is deferred (no coupon-create repo); the birthday SMS is enqueued now.
    await jobs.enqueue(db, "sms.send", { template: "birthday.coupon", customerId: c.id, phone: c.phone }, { uniqueKey: `birthday:${c.id}:${today.getFullYear()}` });
    count += 1;
  }
  return count;
}

