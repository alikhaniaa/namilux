import { faInt, formatToman } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

/**
 * Today's SMS spend against the daily budget. Both figures are MONEY, so they are behind
 * `analytics.read` like the revenue tiles - an admin was still reading the day's spend and the
 * budget ceiling off this card (7 Sep 2026 walkthrough). Without that permission the card keeps
 * only the operational half: how many codes went out, and how much of the budget is used.
 */
export function SmsSpend({ otp, money }: { otp: { sendsToday: number; smsSpendToday: number; budget: number }; money: boolean }) {
  const ratio = otp.budget > 0 ? Math.min(1, otp.smsSpendToday / otp.budget) : 0;
  const hot = ratio >= 0.8;
  return (
    <Card title={fa["dash.sms"]} description={fa["dash.sms.hint"]}>
      {money ? (
        <p className="meter__value" data-hot={hot || undefined}>
          {formatToman(otp.smsSpendToday)} <small>{fa["form.toman"]}</small>
        </p>
      ) : null}
      <div className="meter" data-hot={hot || undefined} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={fa["dash.sms"]}>
        <span style={{ inlineSize: `${String(Math.round(ratio * 100))}%` }} />
      </div>
      <p className="meter__foot">
        <span>
          {fa["dash.otp"]}: <b>{faInt(otp.sendsToday)}</b>
        </span>
        <span>
          {faInt(Math.round(ratio * 100))}٪ {money ? `${fa["dash.of"]} ${formatToman(otp.budget)}` : fa["dash.ofBudget"]}
        </span>
      </p>
    </Card>
  );
}
