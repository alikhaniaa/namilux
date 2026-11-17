"use client";
import { CUSTOMER_TIERS, enDigits } from "@namilux/core/client";
import { CheckList, Checkbox, Field, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { SMS } from "@/i18n/admin-guidance";

export type Segment = { tiers?: string[] | undefined; lastOrderWithinDays?: number | undefined; brandIds?: number[] | undefined; optInOnly: true };

export function SegmentBuilder({ value, onChange, brands }: { value: Segment; onChange: (s: Segment) => void; brands: { id: number; name: string }[] }) {
  const tiers = value.tiers ?? [];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Field label={fa["sms.segment.tiers"]} hint={SMS.tiers} group>
        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
          {CUSTOMER_TIERS.map((t) => (
            <Checkbox
              key={t}
              label={fa[`customers.tier.${t}`]}
              checked={tiers.includes(t)}
              onChange={(e) => {
                const next = e.target.checked ? [...tiers, t] : tiers.filter((x) => x !== t);
                onChange({ ...value, tiers: next.length === 0 ? undefined : next });
              }}
            />
          ))}
        </div>
      </Field>
      <Field label={fa["sms.segment.lastOrder"]} hint={SMS.lastOrder}>
        <Input dir="ltr" inputMode="numeric" value={value.lastOrderWithinDays === undefined ? "" : String(value.lastOrderWithinDays)} onChange={(e) => { const n = Number(enDigits(e.target.value)); onChange({ ...value, lastOrderWithinDays: e.target.value === "" || !Number.isInteger(n) || n < 1 ? undefined : Math.min(730, n) }); }} />
      </Field>
      <Field label={fa["sms.segment.brands"]} hint={SMS.brands} group>
        <CheckList label={fa["sms.segment.brands"]} options={brands} value={value.brandIds ?? []} onChange={(ids) => onChange({ ...value, brandIds: ids.length === 0 ? undefined : ids })} />
      </Field>
      <p className="text-xs text-[var(--ink-2)] md:col-span-3">{SMS.optIn}</p>
    </div>
  );
}
