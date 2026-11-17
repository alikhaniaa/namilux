"use client";
import { faInt } from "@namilux/core/client";
import { useEffect, useState } from "react";
import { MoneyInput } from "./MoneyInput";
import { CheckList, Checkbox, Field } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";

export type Rule = { brandIds?: number[] | undefined; categoryIds?: number[] | undefined; priceMin?: number | undefined; priceMax?: number | undefined; onSale?: boolean | undefined; inStock?: boolean | undefined; tags?: string[] | undefined };
type Option = { id: number; name: string };

function flatten(tree: { id: number; name: string; children?: unknown[] }[], depth = 0): Option[] {
  const out: Option[] = [];
  for (const n of tree) {
    out.push({ id: n.id, name: `${"· ".repeat(depth)}${n.name}` });
    if (Array.isArray(n.children)) out.push(...flatten(n.children as { id: number; name: string; children?: unknown[] }[], depth + 1));
  }
  return out;
}

export function RuleBuilder({ value, onChange }: { value: Rule; onChange: (rule: Rule) => void }) {
  const [brands, setBrands] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [optionsFailed, setOptionsFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    void api<{ id: number; name: string }[] | { items: { id: number; name: string }[] }>("/api/brands")
      .then((r) => setBrands((Array.isArray(r) ? r : r.items).map((b) => ({ id: b.id, name: b.name }))))
      .catch(() => setOptionsFailed(true));
    void api<{ id: number; name: string; children: unknown[] }[] | { tree: { id: number; name: string; children: unknown[] }[] }>("/api/categories")
      .then((r) => setCategories(flatten(Array.isArray(r) ? r : r.tree)))
      .catch(() => setOptionsFailed(true));
  }, []);

  useEffect(() => {
    let active = true;
    setPreviewFailed(false);
    setCount(null);
    const id = setTimeout(() => {
      void api<{ count: number }>("/api/collections/preview", { method: "POST", body: value as Record<string, unknown> })
        .then((r) => { if (active) setCount(r.count); })
        .catch(() => { if (active) setPreviewFailed(true); });
    }, 400);
    return () => { active = false; clearTimeout(id); };
  }, [value]);

  const set = (patch: Partial<Rule>): void => {
    const next: Rule = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof Rule)[]) if (next[k] === undefined || (Array.isArray(next[k]) && (next[k] as number[]).length === 0)) delete next[k];
    onChange(next);
  };

  return (
    <div className="space-y-3 border border-[var(--line)] p-3">
      {optionsFailed ? <p role="alert" className="text-sm text-[var(--danger)]">فهرست برندها یا دسته‌ها بارگذاری نشد. پیش از تغییر انتخاب‌ها، صفحه را دوباره بارگذاری کنید.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={fa["rule.brands"]} group>
          <CheckList label={fa["rule.brands"]} options={brands} value={value.brandIds ?? []} onChange={(ids) => set({ brandIds: ids })} />
        </Field>
        <Field label={fa["rule.categories"]} group>
          <CheckList label={fa["rule.categories"]} options={categories} value={value.categoryIds ?? []} onChange={(ids) => set({ categoryIds: ids })} />
        </Field>
        <MoneyInput label={fa["rule.priceMin"]} value={value.priceMin ?? null} onChange={(v) => set({ priceMin: v ?? undefined })} />
        <MoneyInput label={fa["rule.priceMax"]} value={value.priceMax ?? null} onChange={(v) => set({ priceMax: v ?? undefined })} />
      </div>
      <div className="flex gap-4">
        <Checkbox label={fa["rule.onSale"]} checked={value.onSale === true} onChange={(e) => set({ onSale: e.target.checked ? true : undefined })} />
        <Checkbox label={fa["rule.inStock"]} checked={value.inStock === true} onChange={(e) => set({ inStock: e.target.checked ? true : undefined })} />
      </div>
      <p role={previewFailed ? "alert" : "status"} className="text-sm text-[var(--ink-2)]">{previewFailed ? "تعداد کالاها محاسبه نشد. اتصال را بررسی کنید و دوباره شرط‌ها را انتخاب کنید." : count === null ? fa["common.loading"] : fa["rule.count"].replace("{n}", faInt(count))}</p>
    </div>
  );
}
