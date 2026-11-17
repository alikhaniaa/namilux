"use client";
import { Button, Input, Select } from "@/components/kit";
import PRESETS from "./color-presets.json";

// Product finishes are catalog data; interface colors continue to come from design tokens.
const DEFAULT_COLOR = PRESETS[0]?.hex ?? "";

export function ColorCodeInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value ?? "");
  const preset = PRESETS.find((p) => p.hex === value?.toLowerCase());
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="min-w-0 flex-1" aria-label="رنگ‌های آماده" value={preset?.hex ?? ""} onChange={(e) => { if (e.target.value !== "") onChange(e.target.value); }}>
          <option value="">{valid ? "رنگ سفارشی" : "انتخاب رنگ آماده"}</option>
          {PRESETS.map((p) => <option key={p.hex} value={p.hex}>{p.label}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-xs">
          <span>انتخاب رنگ</span>
          <input type="color" className="h-8 w-8 cursor-pointer border border-[var(--line)]" aria-label="انتخاب رنگ دلخواه" value={valid ? value ?? DEFAULT_COLOR : DEFAULT_COLOR} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Input dir="ltr" className="min-w-0 flex-1" aria-label="کد رنگ" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} maxLength={7} placeholder="#RRGGBB" />
        <span className="h-8 w-8 shrink-0 border border-[var(--line)]" aria-hidden="true" style={{ backgroundColor: valid ? value ?? "transparent" : "transparent" }} />
        <Button size="sm" variant="ghost" disabled={value === null} onClick={() => onChange(null)}>پاک کردن</Button>
      </div>
      <p className="text-xs text-[var(--ink-2)]">رنگ آماده را انتخاب کنید، روی انتخاب رنگ بزنید یا کد رنگ را وارد کنید. این بخش اختیاری است.</p>
    </div>
  );
}
