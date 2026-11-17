"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LoyaltyRules } from "@namilux/core/client";
import { faDigits, CUSTOMER_TIERS, enDigits, faInt } from "@namilux/core/client";
import { Button, Field, Input, Select, Switch } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { fa } from "@/i18n/fa";
import { LOYALTY } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

function Num({ label, hint, value, onChange, max }: { label: string; hint?: string; value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <Input dir="ltr" inputMode="numeric" value={faDigits(value)} onChange={(e) => { const n = Number(enDigits(e.target.value)); if (Number.isInteger(n) && n >= 0 && (max === undefined || n <= max)) onChange(n); }} />
    </Field>
  );
}

function TierSelect({ value, onChange }: { value: LoyaltyRules["benefits"]["earlyAccess"]["minTier"]; onChange: (t: LoyaltyRules["benefits"]["earlyAccess"]["minTier"]) => void }) {
  return (
    <Select className="h-8 w-28 text-xs" aria-label={LOYALTY.minTier} title={LOYALTY.minTier} value={value} onChange={(e) => onChange(e.target.value as typeof value)}>
      {CUSTOMER_TIERS.map((t) => (
        <option key={t} value={t}>
          {fa[`customers.tier.${t}`]}
        </option>
      ))}
    </Select>
  );
}

export function LoyaltyRulesForm({ initial }: { initial: LoyaltyRules }) {
  const router = useRouter();
  const [r, setR] = useState<LoyaltyRules>(initial);
  const [busy, setBusy] = useState(false);
  const b = r.benefits;
  const setB = (patch: Partial<LoyaltyRules["benefits"]>) => setR({ ...r, benefits: { ...b, ...patch } });

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/loyalty", { method: "PUT", body: r });
      toast(fa["loyalty.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Switch label={fa["common.active"]} checked={r.enabled} onChange={(e) => setR({ ...r, enabled: e.target.checked })} />
        <p className="text-xs text-[var(--ink-2)]">{LOYALTY.enabled}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MoneyInput label={LOYALTY.earnPerLabel} hint={LOYALTY.earnPer} value={r.earnPerToman} onChange={(n) => setR({ ...r, earnPerToman: Math.max(1, n ?? 0) })} />
        <MoneyInput label={fa["loyalty.pointValue"]} hint={LOYALTY.pointValue} value={r.pointValueToman} onChange={(n) => setR({ ...r, pointValueToman: Math.max(1, n ?? 0) })} />
        <Num label={fa["loyalty.maxRedeem"]} hint={LOYALTY.maxRedeem} value={r.maxRedeemPercent} max={100} onChange={(n) => setR({ ...r, maxRedeemPercent: n })} />
        <Num label={fa["loyalty.minRedeem"]} hint={LOYALTY.minRedeem} value={r.minRedeem} onChange={(n) => setR({ ...r, minRedeem: n })} />
        <Num label={fa["loyalty.expiry"]} hint={LOYALTY.expiry} value={r.expiryMonths} onChange={(n) => setR({ ...r, expiryMonths: Math.max(1, n) })} />
      </div>
      <fieldset className="border border-[var(--line)] p-3">
        <legend className="px-1 text-sm font-medium">{fa["loyalty.tiers"]}</legend>
        <p className="mb-2 text-xs text-[var(--ink-2)]">{LOYALTY.tiers}</p>
        <div className="grid gap-3 md:grid-cols-3">
          {(["silver", "gold", "diamond"] as const).map((t) => (
            <MoneyInput key={t} label={fa[`customers.tier.${t}`]} value={r.tierThresholds[t]} onChange={(n) => setR({ ...r, tierThresholds: { ...r.tierThresholds, [t]: n ?? 0 } })} />
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-3 border border-[var(--line)] p-3">
        <legend className="px-1 text-sm font-medium">{fa["loyalty.benefits"]}</legend>
        <p className="text-xs text-[var(--ink-2)]">{LOYALTY.benefits}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label={LOYALTY.birthdayCoupon} checked={b.birthdayCoupon.enabled} onChange={(e) => setB({ birthdayCoupon: { ...b.birthdayCoupon, enabled: e.target.checked } })} />
          <TierSelect value={b.birthdayCoupon.minTier} onChange={(t) => setB({ birthdayCoupon: { ...b.birthdayCoupon, minTier: t } })} />
          <Input dir="ltr" className="h-8 w-16" aria-label={LOYALTY.birthdayPercent} value={faDigits(b.birthdayCoupon.percent)} onChange={(e) => setB({ birthdayCoupon: { ...b.birthdayCoupon, percent: Math.min(100, Math.max(1, Number(enDigits(e.target.value)) || 1)) } })} />
          <span className="text-xs text-[var(--ink-2)]">% · {faInt(b.birthdayCoupon.validDays)} {fa["date.day"]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label={LOYALTY.earlyAccess} checked={b.earlyAccess.enabled} onChange={(e) => setB({ earlyAccess: { ...b.earlyAccess, enabled: e.target.checked } })} />
          <TierSelect value={b.earlyAccess.minTier} onChange={(t) => setB({ earlyAccess: { ...b.earlyAccess, minTier: t } })} />
          <Input dir="ltr" className="h-8 w-16" aria-label={LOYALTY.earlyAccessHours} value={faDigits(b.earlyAccess.hours)} onChange={(e) => setB({ earlyAccess: { ...b.earlyAccess, hours: Math.max(1, Number(enDigits(e.target.value)) || 1) } })} />
          <span className="text-xs text-[var(--ink-2)]">{LOYALTY.hours}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label={LOYALTY.freeExpressTehran} checked={b.freeExpressTehran.enabled} onChange={(e) => setB({ freeExpressTehran: { ...b.freeExpressTehran, enabled: e.target.checked } })} />
          <TierSelect value={b.freeExpressTehran.minTier} onChange={(t) => setB({ freeExpressTehran: { ...b.freeExpressTehran, minTier: t } })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label={LOYALTY.priorityWhatsapp} checked={b.priorityWhatsapp.enabled} onChange={(e) => setB({ priorityWhatsapp: { ...b.priorityWhatsapp, enabled: e.target.checked } })} />
          <TierSelect value={b.priorityWhatsapp.minTier} onChange={(t) => setB({ priorityWhatsapp: { ...b.priorityWhatsapp, minTier: t } })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Switch label={LOYALTY.reviewBonus} checked={b.reviewBonus.enabled} onChange={(e) => setB({ reviewBonus: { ...b.reviewBonus, enabled: e.target.checked } })} />
          <Input dir="ltr" className="h-8 w-20" aria-label={LOYALTY.reviewBonusPoints} value={faDigits(b.reviewBonus.points)} onChange={(e) => setB({ reviewBonus: { ...b.reviewBonus, points: Math.max(0, Number(enDigits(e.target.value)) || 0) } })} />
        </div>
      </fieldset>
      <fieldset className="border border-[var(--line)] p-3">
        <legend className="px-1 text-sm font-medium">{fa["loyalty.referral"]}</legend>
        <p className="mb-2 text-xs text-[var(--ink-2)]">{LOYALTY.referral}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Switch label={fa["common.active"]} checked={r.referral.enabled} onChange={(e) => setR({ ...r, referral: { ...r.referral, enabled: e.target.checked } })} />
          <Num label={LOYALTY.referrerPoints} value={r.referral.referrerPoints} onChange={(n) => setR({ ...r, referral: { ...r.referral, referrerPoints: n } })} />
          <Num label={LOYALTY.refereeCouponPercent} value={r.referral.refereeCouponPercent} max={100} onChange={(n) => setR({ ...r, referral: { ...r.referral, refereeCouponPercent: n } })} />
        </div>
      </fieldset>
      <Button disabled={busy} onClick={() => void save()}>
        {fa["common.save"]}
      </Button>
    </div>
  );
}
