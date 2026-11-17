"use client";
import type { ProductAdminInput } from "@namilux/core/client";
import { enDigits, faInt } from "@namilux/core/client";
import { ProductPicker } from "./ProductPicker";
import type { FormApi } from "@/components/forms/Form";
import { Button, Checkbox, Input } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

type Spec = ProductAdminInput["specs"][number];
export type AttributeDefLite = { id: number; key: string; label: string; kind: "text" | "number" | "bool" | "color"; unit: string | null };

export function TabSpecs({ f, attributes }: { f: FormApi<ProductAdminInput>; attributes: AttributeDefLite[] }) {
  const specs = f.values.specs;
  const values = f.values.attributes;

  function update(next: Spec[]): void {
    f.set("specs", next.map((s, i) => ({ ...s, sort: i })));
  }
  function setAttr(id: number, patch: { valueText?: string | null; valueNum?: number | null }): void {
    const others = values.filter((v) => v.attributeId !== id);
    const cur = values.find((v) => v.attributeId === id) ?? { attributeId: id, valueText: null, valueNum: null };
    const merged = { ...cur, ...patch };
    const empty = (merged.valueText === null || merged.valueText === undefined || merged.valueText === "") && (merged.valueNum === null || merged.valueNum === undefined);
    f.set("attributes", empty ? others : [...others, merged]);
  }
  async function copyFrom(id: number): Promise<void> {
    try {
      const view = await api<{ full: { specs: { groupName: string | null; label: string; value: string; sort: number }[] } }>(`/api/products/${String(id)}`);
      update([...specs, ...view.full.specs.map((s) => ({ groupName: s.groupName, label: s.label, value: s.value, sort: 0 }))]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0 space-y-2">
        <p className="text-xs text-[var(--ink-2)]">مشخصات اختیاری است. مثلاً عنوان «توان» و مقدار «۱۵۰۰ وات». ردیف‌هایی که عنوان و مقدارشان خالی باشد، هنگام ذخیره نادیده گرفته می‌شوند.</p>
        <div className="admin-table-scroll">
        <table className="w-full min-w-96 text-sm">
          <thead className="text-xs text-[var(--ink-2)]">
            <tr>
              <th className="p-1 text-start">{fa["products.specs.group"]}</th>
              <th className="p-1 text-start">{fa["products.specs.label"]}</th>
              <th className="p-1 text-start">{fa["products.specs.value"]}</th>
              <th className="p-1" />
            </tr>
          </thead>
          <tbody>
            {specs.map((s, i) => (
              <tr key={i} className="border-t border-[var(--line)]">
                <td className="p-1">
                  <Input className="h-8" value={s.groupName ?? ""} onChange={(e) => update(specs.map((x, j) => (j === i ? { ...x, groupName: e.target.value === "" ? null : e.target.value } : x)))} maxLength={80} />
                </td>
                <td className="p-1">
                  <Input className="h-8" aria-label={`عنوان مشخصه ${faInt(i + 1)}`} aria-invalid={f.errors[`specs.${String(i)}.label`] !== undefined} value={s.label} onChange={(e) => update(specs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={120} />
                  {f.errors[`specs.${String(i)}.label`] ? <p className="text-xs text-[var(--danger)]">{f.errors[`specs.${String(i)}.label`]}</p> : null}
                </td>
                <td className="p-1">
                  <Input className="h-8" aria-label={`مقدار مشخصه ${faInt(i + 1)}`} aria-invalid={f.errors[`specs.${String(i)}.value`] !== undefined} value={s.value} onChange={(e) => update(specs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} maxLength={500} />
                  {f.errors[`specs.${String(i)}.value`] ? <p className="text-xs text-[var(--danger)]">{f.errors[`specs.${String(i)}.value`]}</p> : null}
                </td>
                <td className="p-1 whitespace-nowrap">
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => { const n = [...specs]; const a = n[i]; const b = n[i - 1]; if (a && b) { n[i] = b; n[i - 1] = a; update(n); } }}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update(specs.filter((_, j) => j !== i))}>
                    ×
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => update([...specs, { groupName: specs[specs.length - 1]?.groupName ?? null, label: "", value: "", sort: specs.length }])}>
            {fa["products.specs.add"]}
          </Button>
          <ProductPicker label={fa["products.specs.copyFrom"]} onPick={(p) => void copyFrom(p.id)} />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{fa["products.attributes"]}</h3>
        <div className="space-y-2">
          {attributes.map((a) => {
            const v = values.find((x) => x.attributeId === a.id);
            return (
              <label key={a.id} className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
                <span className="text-[var(--ink-2)]">
                  {a.label}
                  {a.unit !== null ? <span className="ms-1 text-xs">({a.unit})</span> : null}
                </span>
                {a.kind === "bool" ? (
                  <Checkbox label="" checked={v?.valueText === "true"} onChange={(e) => setAttr(a.id, { valueText: e.target.checked ? "true" : null })} />
                ) : a.kind === "number" ? (
                  <Input dir="ltr" inputMode="decimal" className="h-8" value={v?.valueNum === null || v?.valueNum === undefined ? "" : String(v.valueNum)} onChange={(e) => { const n = Number(enDigits(e.target.value)); setAttr(a.id, { valueNum: e.target.value === "" || !Number.isFinite(n) ? null : n }); }} />
                ) : (
                  <Input className="h-8" dir={a.kind === "color" ? "ltr" : undefined} value={v?.valueText ?? ""} onChange={(e) => setAttr(a.id, { valueText: e.target.value === "" ? null : e.target.value })} maxLength={200} />
                )}
              </label>
            );
          })}
          {attributes.length === 0 ? <p className="text-xs text-[var(--ink-2)]">{fa["table.empty"]}</p> : null}
        </div>
      </section>
    </div>
  );
}
