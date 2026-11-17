"use client";
import { DISPLAY_NAME_MAX, faInt, faZwnj } from "@namilux/core/client";
import { useRef } from "react";
import { Button, Field, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function PersianText({ value, onChange, label, max = DISPLAY_NAME_MAX, preview, error }: { value: string; onChange: (v: string) => void; label: string; max?: number; preview?: "card"; error?: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const suggestion = faZwnj(value);
  const insertZwnj = (): void => {
    const el = ref.current;
    if (el === null) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const next = `${value.slice(0, start)}‌${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  };
  return (
    <div className="space-y-2">
      <Field group label={label} hint={fa["form.chars"].replace("{n}", faInt(value.length)).replace("{m}", faInt(max))} {...(error === undefined ? {} : { error })}>
        <span className="flex gap-1">
          <Input ref={ref} aria-label={label} aria-invalid={error !== undefined && error !== ""} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} />
          <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={insertZwnj} title={fa["form.zwnj"]}>
            {fa["form.zwnj"]}
          </Button>
        </span>
      </Field>
      {suggestion !== value && suggestion.trim() !== "" ? (
        <button type="button" className="text-xs text-[var(--accent)] underline" onClick={() => onChange(suggestion)}>
          {fa["form.zwnjSuggest"]}: {suggestion}
        </button>
      ) : null}
      {preview === "card" ? (
        <div className="w-44 border border-[var(--line)] bg-[var(--surface)] p-2">
          <div className="mb-2 h-24 bg-[var(--plate)]" aria-hidden="true" />
          <p className="line-clamp-2 min-h-[2.6em] text-sm font-semibold leading-snug">{value || "ثبت نشده"}</p>
        </div>
      ) : null}
    </div>
  );
}
