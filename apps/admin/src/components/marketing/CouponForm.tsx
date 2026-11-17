"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CouponAdminInput } from "@namilux/core/client";
import { faDigits, COUPON_KINDS, couponAdminSchema, enDigits, formatToman, normalizePhone } from "@namilux/core/client";
import { ProductPicker } from "@/components/products/ProductPicker";
import { Form } from "@/components/forms/Form";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, CheckList, Checkbox, Field, Input, Select, StatusBadge, Switch } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { COUPON } from "@/i18n/admin-guidance";
import { api } from "@/lib/api-client";

export type ScopeOptions = { brands: { id: number; name: string }[]; categories: { id: number; name: string }[]; collections: { id: number; name: string }[] };
type Scope = NonNullable<CouponAdminInput["applies"]>;

function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: number; name: string }[]; value: number[]; onChange: (ids: number[]) => void }) {
  return (
    <Field label={label} group>
      <CheckList label={label} options={options} value={value} onChange={onChange} />
    </Field>
  );
}

function ScopeEditor({ label, hint, value, onChange, options, names, onName }: { label: string; hint: string; value: Scope; onChange: (s: Scope) => void; options: ScopeOptions; names: Record<number, string>; onName: (id: number, name: string) => void }) {
  const set = (k: keyof Scope, ids: number[]) => onChange({ ...value, [k]: ids.length === 0 ? undefined : ids });
  return (
    <fieldset className="space-y-2 border border-[var(--line)] p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <p className="text-xs text-[var(--ink-2)]">{hint}</p>
      <div className="grid gap-2 md:grid-cols-3">
        <MultiSelect label={fa["coupons.scope.brands"]} options={options.brands} value={value.brandIds ?? []} onChange={(ids) => set("brandIds", ids)} />
        <MultiSelect label={fa["coupons.scope.categories"]} options={options.categories} value={value.categoryIds ?? []} onChange={(ids) => set("categoryIds", ids)} />
        <MultiSelect label={fa["coupons.scope.collections"]} options={options.collections} value={value.collectionIds ?? []} onChange={(ids) => set("collectionIds", ids)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ink-2)]">{COUPON.scopeProducts}</span>
        {(value.productIds ?? []).map((id) => (
          <button key={id} type="button" onClick={() => set("productIds", (value.productIds ?? []).filter((x) => x !== id))}>
            <StatusBadge>{names[id] ?? `#${String(id)}`} ×</StatusBadge>
          </button>
        ))}
        <ProductPicker
          onPick={(p) => {
            onName(p.id, p.displayName);
            if (!(value.productIds ?? []).includes(p.id)) set("productIds", [...(value.productIds ?? []), p.id]);
          }}
        />
      </div>
    </fieldset>
  );
}

export function CouponForm({ initial, options, productNames }: { initial: CouponAdminInput; options: ScopeOptions; productNames: Record<number, string> }) {
  const router = useRouter();
  const [names, setNames] = useState(productNames);
  const [phone, setPhone] = useState("");
  const isNew = initial.id === undefined;

  return (
    <Form<CouponAdminInput>
      schemaKey="coupon"
      schema={couponAdminSchema}
      initial={initial}
      action={isNew ? "/api/coupons" : `/api/coupons/${String(initial.id)}`}
      method={isNew ? "POST" : "PUT"}
      onSaved={(data) => {
        toast(fa["coupons.saved"]);
        const id = (data as { id?: number }).id;
        if (isNew && id !== undefined) router.push(`/marketing/coupons/${String(id)}`);
        else router.refresh();
      }}
    >
      {(f) => {
        const v = f.values;
        const onName = (id: number, name: string) => setNames((n) => ({ ...n, [id]: name }));
        return (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={fa["coupons.code"]} hint={fa["coupons.code.hint"]} error={f.errors.code ?? ""}>
                <Input dir="ltr" className="uppercase" value={v.code} onChange={(e) => f.set("code", e.target.value.toUpperCase())} maxLength={20} />
              </Field>
              <Field label={fa["coupons.kind"]} hint={COUPON.kind}>
                <Select value={v.kind} onChange={(e) => { f.set("kind", e.target.value); if (e.target.value === "free_shipping") { f.set("value", 0); f.set("maxDiscount", null); } }}>
                  {COUPON_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {fa[`coupons.kind.${k}`]}
                    </option>
                  ))}
                </Select>
              </Field>
              {v.kind === "percent" ? (
                <Field label={`${fa["coupons.value"]} (%)`} hint={COUPON.valuePercent} error={f.errors.value ?? ""}>
                  <Input dir="ltr" inputMode="numeric" value={faDigits(v.value)} onChange={(e) => f.set("value", Number(enDigits(e.target.value)) || 0)} />
                </Field>
              ) : v.kind === "fixed" ? (
                <MoneyInput label={fa["coupons.value"]} hint={COUPON.valueFixed} value={v.value} onChange={(n) => f.set("value", n ?? 0)} error={f.errors.value ?? ""} />
              ) : (
                <div />
              )}
              <MoneyInput label={fa["coupons.minSubtotal"]} hint={COUPON.minSubtotal} value={v.minSubtotal} onChange={(n) => f.set("minSubtotal", n ?? 0)} />
              {v.kind !== "free_shipping" ? <MoneyInput label={fa["coupons.maxDiscount"]} hint={COUPON.maxDiscount} value={v.maxDiscount ?? null} onChange={(n) => f.set("maxDiscount", n)} /> : <div />}
              <Field label={fa["coupons.usageLimit"]} hint={COUPON.usageLimit}>
                <Input dir="ltr" inputMode="numeric" value={v.usageLimit === null || v.usageLimit === undefined ? "" : String(v.usageLimit)} onChange={(e) => f.set("usageLimit", e.target.value === "" ? null : Number(enDigits(e.target.value)) || null)} />
              </Field>
              <Field label={fa["coupons.perCustomer"]} hint={COUPON.perCustomer}>
                <Input dir="ltr" inputMode="numeric" value={faDigits(v.usagePerCustomer)} onChange={(e) => f.set("usagePerCustomer", Math.max(1, Number(enDigits(e.target.value)) || 1))} />
              </Field>
              <Field label={fa["coupons.window"]} hint={COUPON.window} group>
                <div className="grid grid-cols-2 gap-1">
                  <JalaliDate value={v.startsAt ?? null} onChange={(iso) => f.set("startsAt", iso)} withTime />
                  <JalaliDate value={v.endsAt ?? null} onChange={(iso) => f.set("endsAt", iso)} withTime />
                </div>
                {f.errors.endsAt !== undefined ? <span className="text-xs text-[var(--danger)]">{f.errors.endsAt}</span> : null}
              </Field>
              <Field label={fa["coupons.personal"]} hint={COUPON.personal} group>
                <span className="flex gap-1">
                  <Input dir="ltr" inputMode="tel" placeholder="09…" aria-label={COUPON.personalInput} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const n = normalizePhone(phone);
                      if (n === null) return;
                      void api<{ items: { id: string }[] }>(`/api/customers?q=${encodeURIComponent(n)}`).then((r) => {
                        const id = r.items[0]?.id ?? null;
                        f.set("customerId", id);
                        toast(id === null ? fa["shell.noResults"] : fa["common.saved"], id === null ? "error" : "ok");
                      });
                    }}
                  >
                    {fa["manual.lookup"]}
                  </Button>
                  {v.customerId ? (
                    <Button size="sm" variant="ghost" onClick={() => f.set("customerId", null)}>
                      ×
                    </Button>
                  ) : null}
                </span>
              </Field>
            </div>
            <p className="text-xs text-[var(--ink-2)]">{COUPON.flags}</p>
            <div className="flex flex-wrap gap-4">
              <Checkbox label={fa["coupons.firstOrder"]} checked={v.firstOrderOnly} onChange={(e) => f.set("firstOrderOnly", e.target.checked)} />
              <Checkbox label={fa["coupons.stackable"]} checked={v.stackableWithPoints} onChange={(e) => f.set("stackableWithPoints", e.target.checked)} />
              <Switch label={fa["coupons.active"]} checked={v.isActive} onChange={(e) => f.set("isActive", e.target.checked)} />
            </div>
            <ScopeEditor label={fa["coupons.applies"]} hint={COUPON.applies} value={v.applies} onChange={(s) => f.set("applies", s)} options={options} names={names} onName={onName} />
            <ScopeEditor label={fa["coupons.excludes"]} hint={COUPON.excludes} value={v.excludes} onChange={(s) => f.set("excludes", s)} options={options} names={names} onName={onName} />
            {v.kind === "fixed" ? <p className="text-xs text-[var(--ink-2)]">{formatToman(v.value)}</p> : null}
          </div>
        );
      }}
    </Form>
  );
}
