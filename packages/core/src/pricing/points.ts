import { faInt, formatToman } from "../persian";
import type { LoyaltyRules } from "../loyalty/rules";

export type PointsQuote = {
  available: number;
  used: number;
  value: number;
  capped: boolean;
  reason?: "disabled" | "below_min" | "coupon_not_stackable" | "not_requested";
};

export function redeemValue(
  balance: number,
  subtotal: number,
  rules: LoyaltyRules,
): { points: number; value: number } {
  if (!rules.enabled) return { points: 0, value: 0 };
  const capPoints = Math.floor((subtotal * rules.maxRedeemPercent) / 100 / rules.pointValueToman);
  let points = Math.min(Math.max(balance, 0), Math.max(capPoints, 0));
  if (points < rules.minRedeem) points = 0;
  return { points, value: points * rules.pointValueToman };
}

export function pointsToEarn(paidAmount: number, rules: LoyaltyRules): number {
  if (!rules.enabled || paidAmount <= 0) return 0;
  return Math.floor(paidAmount / rules.earnPerToman);
}

export function pointsQuote(i: {
  balance: number;
  subtotal: number;
  usePoints: boolean;
  couponStackable: boolean;
  rules: LoyaltyRules;
}): PointsQuote {
  const available = Math.max(i.balance, 0);
  if (!i.usePoints) return { available, used: 0, value: 0, capped: false, reason: "not_requested" };
  if (!i.couponStackable) return { available, used: 0, value: 0, capped: false, reason: "coupon_not_stackable" };
  if (!i.rules.enabled) return { available, used: 0, value: 0, capped: false, reason: "disabled" };
  const { points, value } = redeemValue(i.balance, i.subtotal, i.rules);
  const capped = points > 0 && points < available;
  return {
    available,
    used: points,
    value,
    capped,
    ...(points === 0 ? { reason: "below_min" as const } : {}),
  };
}

export function pointsToggleFa(points: number, value: number): string {
  return `استفاده از ${faInt(points)} امتیاز (${formatToman(value)} تومان)`;
}
