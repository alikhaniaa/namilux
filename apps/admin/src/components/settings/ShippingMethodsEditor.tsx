"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { enDigits, faInt, faDigits } from "@namilux/core/client";
import { PROVINCES } from "@namilux/core/geo";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Card, Checkbox, EmptyState, Field, Input, StatusBadge, Switch, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { SHIPPING } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";
import { toman } from "@/lib/money";

export type ShippingRow = { id: number; key: string; name: string; description: string; kind: string; rate: { flat?: number; byProvince?: Record<string, number>; freeAbove?: number }; provinces: string[] | null; etaMinDays: number; etaMaxDays: number; isActive: boolean; sort: number };

const kindLabel = (k: string): string => (k === "free" ? fa["shipping.kind.free"] : k === "flat" ? fa["shipping.kind.flat"] : k === "by_province" ? fa["shipping.kind.by_province"] : k === "pickup" ? fa["shipping.kind.pickup"] : k);

export function ShippingMethodsEditor({ items }: { items: ShippingRow[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<ShippingRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (edit === null) return;
    setBusy(true);
    try {
      const { id, key: _k, kind: _kind, ...patch } = edit;
      void _k;
      void _kind;
      await api("/api/settings/shipping", { method: "PUT", body: { id, patch } });
      toast(fa["shipping.saved"]);
      setEdit(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return <EmptyState text={fa["table.empty"]} />;
  return (
    <Card flush>
      <ul className="row-list">
        {items.map((m) =>
          edit !== null && edit.id === m.id ? (
            <li key={m.id} className="row-list__edit">
              <div className="inline-editor">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={fa["shipping.method"]} hint={SHIPPING.name}>
                    <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={80} />
                  </Field>
                  <Field label={fa["shipping.kind"]} hint={SHIPPING.kind}>
                    <Input readOnly value={kindLabel(edit.kind)} />
                  </Field>
                  <Field label={fa["cat.description"]} hint={SHIPPING.description}>
                    <Textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={300} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <MoneyInput label={SHIPPING.flatLabel} hint={SHIPPING.flat} value={edit.rate.flat ?? null} onChange={(n) => { const { flat: _f, ...rest } = edit.rate; void _f; setEdit({ ...edit, rate: n === null ? rest : { ...rest, flat: n } }); }} />
                    <MoneyInput label={SHIPPING.freeAboveLabel} hint={SHIPPING.freeAbove} value={edit.rate.freeAbove ?? null} onChange={(n) => { const { freeAbove: _f, ...rest } = edit.rate; void _f; setEdit({ ...edit, rate: n === null ? rest : { ...rest, freeAbove: n } }); }} />
                  </div>
                  <Field label={fa["shipping.eta"]} hint={SHIPPING.eta} group>
                    <div className="grid grid-cols-2 gap-1">
                      <Input dir="ltr" inputMode="numeric" aria-label={SHIPPING.etaMin} value={faDigits(edit.etaMinDays)} onChange={(e) => setEdit({ ...edit, etaMinDays: Math.max(0, Number(enDigits(e.target.value)) || 0) })} />
                      <Input dir="ltr" inputMode="numeric" aria-label={SHIPPING.etaMax} value={faDigits(edit.etaMaxDays)} onChange={(e) => setEdit({ ...edit, etaMaxDays: Math.max(0, Number(enDigits(e.target.value)) || 0) })} />
                    </div>
                  </Field>
                  <Field label={fa["shipping.provinces"]} hint="اگر هیچ استانی انتخاب نکنید، این روش برای همهٔ استان‌ها فعال است." group>
                    <div className="ui-checklist">
                      {PROVINCES.map(p => <Checkbox key={p.code} label={p.name} checked={edit.provinces?.includes(p.code) ?? false} onChange={e => {
                        const provinces = e.target.checked ? [...(edit.provinces ?? []), p.code] : (edit.provinces ?? []).filter(code => code !== p.code);
                        setEdit({ ...edit, provinces: provinces.length === 0 ? null : provinces });
                      }} />)}
                    </div>
                  </Field>
                  <details className="min-w-0 border border-[var(--line)] p-3">
                    <summary className="cursor-pointer text-sm">{SHIPPING.byProvinceLabel}</summary>
                    <p className="my-2 text-xs text-[var(--ink-2)]">هزینهٔ هر استان را به تومان وارد کنید. خالی یعنی هزینهٔ جداگانه‌ای برای آن استان تعیین نشده است.</p>
                    <div className="grid max-h-80 gap-3 overflow-y-auto">
                      {PROVINCES.map(p => <MoneyInput key={p.code} label={p.name} value={edit.rate.byProvince?.[p.code] ?? null} onChange={amount => {
                        const byProvince = { ...edit.rate.byProvince };
                        if (amount === null) delete byProvince[p.code];
                        else byProvince[p.code] = amount;
                        setEdit({ ...edit, rate: { ...edit.rate, byProvince } });
                      }} />)}
                    </div>
                  </details>
                  <div className="flex items-center gap-4">
                    <Switch label={fa["shipping.active"]} checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
                    <label className="flex items-center gap-2 text-sm">
                      {fa["cat.sort"]}
                      <Input dir="ltr" inputMode="numeric" className="h-8 w-16" value={faDigits(edit.sort)} onChange={(e) => setEdit({ ...edit, sort: Number(enDigits(e.target.value)) || 0 })} />
                    </label>
                  </div>
                </div>
                <p className="inline-editor__hint">
                  {SHIPPING.active} {SHIPPING.sort}
                </p>
                <div className="inline-editor__foot">
                  <div className="inline-editor__actions">
                    <Button variant="ghost" onClick={() => setEdit(null)}>
                      {fa["common.cancel"]}
                    </Button>
                    <Button busy={busy} disabled={edit.name.trim() === ""} onClick={() => void save()}>
                      {fa["common.save"]}
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          ) : (
            <li key={m.id} className="row-list__row">
              <span className="row-list__main">
                <b className="font-semibold">{m.name}</b>
              </span>
              {!m.isActive ? <StatusBadge tone="muted">{fa["common.inactive"]}</StatusBadge> : null}
              <span className="row-list__meta">
                <span>{m.rate.flat !== undefined ? toman(m.rate.flat) : kindLabel(m.kind)}</span>
                {m.rate.freeAbove !== undefined ? <span>{`${fa["shipping.kind.free"]} از ${toman(m.rate.freeAbove)}`}</span> : null}
                <span>
                  {faInt(m.etaMinDays)} تا {faInt(m.etaMaxDays)} {fa["date.day"]}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} disabled={edit !== null} onClick={() => setEdit({ ...m })}>
                {fa["common.edit"]}
              </Button>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}
