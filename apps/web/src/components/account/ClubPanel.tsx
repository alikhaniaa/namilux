"use client";
import type { CustomerTier, LoyaltyLedgerEntry, LoyaltyReason, TierInfo } from "@namilux/core/client";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/state/toast-store";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

const TIER_KEY: Record<CustomerTier, FaKey> = {
  member: "club.tier.member",
  silver: "club.tier.silver",
  gold: "club.tier.gold",
  diamond: "club.tier.diamond",
};
const REASON_KEY: Record<LoyaltyReason, FaKey> = {
  earn: "club.reason.earn",
  redeem: "club.reason.redeem",
  expire: "club.reason.expire",
  adjust: "club.reason.adjust",
  referral: "club.reason.referral",
  birthday: "club.reason.birthday",
  review: "club.reason.review",
};

export type ClubBenefits = {
  birthdayCoupon: boolean;
  earlySaleAccessHours: number;
  freeExpressTehran: boolean;
  priorityWhatsapp: boolean;
  reviewBonusPoints: number;
};

export function ClubPanel({
  info,
  history,
  referralCode,
  pointsBalance = 0,
  benefits,
}: {
  info: TierInfo;
  history: LoyaltyLedgerEntry[];
  referralCode: string;
  pointsBalance?: number;
  benefits?: ClubBenefits;
}): React.ReactNode {
  const [copied, setCopied] = useState(false);
  const tierKey = TIER_KEY[info.tier];
  const perks: string[] = [];
  if (benefits !== undefined) {
    if (benefits.birthdayCoupon) perks.push(t("club.benefit.birthdayCoupon"));
    if (benefits.earlySaleAccessHours > 0) perks.push(t("club.benefit.earlyAccess", { n: benefits.earlySaleAccessHours }));
    if (benefits.freeExpressTehran) perks.push(t("club.benefit.freeExpress"));
    if (benefits.priorityWhatsapp) perks.push(t("club.benefit.priorityWhatsapp"));
    if (benefits.reviewBonusPoints > 0) perks.push(t("club.benefit.reviewBonus", { n: benefits.reviewBonusPoints }));
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(referralCode);
      setCopied(true);
      toast.show({ key: "club.referral.copied" });
    } catch {
      /* clipboard blocked: the code is still on screen to select */
    }
  };

  return (
    <div className="grid gap-8">
      <section className="grid gap-4 md:grid-cols-2">
        <div className="card grid gap-1 p-5">
          <p className="t-xs text-ink-3">{t("club.points")}</p>
          <p className="d-2 tnum">
            {faInt(pointsBalance)} <span className="t-sm text-ink-2">{t("club.points.unit")}</span>
          </p>
        </div>
        <div className="card grid gap-1 p-5">
          <p className="t-xs text-ink-3">{t("club.tier")}</p>
          <p className="d-3">{t(tierKey)}</p>
          <p className="t-sm text-ink-2">
            {t("club.spend")}: {formatToman(info.spend12m)} {t("product.price.unit")}
          </p>
          {info.nextTier !== null && info.toNextTier !== null ? (
            <p className="t-sm text-ink-2">{t("club.next", { amount: formatToman(info.toNextTier), tier: t(TIER_KEY[info.nextTier]) })}</p>
          ) : (
            <p className="t-sm text-ink-2">{t("club.top")}</p>
          )}
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="t-sm font-semibold">{t("club.benefits")}</h3>
        {perks.length === 0 ? (
          <p className="t-body text-ink-2">{t("club.benefit.none")}</p>
        ) : (
          <ul className="grid gap-2 t-body">
            {perks.map((p) => (
              <li key={p} className="flex items-center gap-2">
                <span className="size-[6px] shrink-0 rounded-full bg-ok" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card grid gap-3 p-5">
        <h3 className="t-sm font-semibold">{t("club.referral")}</h3>
        <p className="t-body text-ink-2">{t("club.referral.body")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="label border border-line-strong px-3 py-2 text-ink">{referralCode}</code>
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            {copied ? t("club.referral.copied") : t("club.referral.copy")}
          </Button>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="t-sm font-semibold">{t("club.history")}</h3>
        {history.length === 0 ? (
          <p className="t-body text-ink-2">{t("club.history.empty")}</p>
        ) : (
          <ul className="grid">
            {history.map((h) => {
              const reasonKey = REASON_KEY[h.reason];
              return (
                <li key={h.id} className="hairline-t flex items-center justify-between gap-3 py-3 t-sm">
                  <span className="grid gap-0.5">
                    <span>{t(reasonKey)}</span>
                    <span className="t-xs text-ink-3">{formatJalali(h.createdAt, "long")}</span>
                  </span>
                  <span className={`tnum ${h.delta < 0 ? "text-danger" : "text-ok"}`}>
                    {h.delta < 0 ? "−" : "+"}
                    {faInt(Math.abs(h.delta))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
