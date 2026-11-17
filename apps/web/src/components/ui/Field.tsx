"use client";
import { enDigits, faDigits } from "@namilux/core/client";
import { useId } from "react";
import { Icon } from "./Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function Field({
  name,
  label,
  type = "text",
  inputMode,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required = false,
  autoComplete,
  maxLength,
  digits,
  placeholder,
}: {
  name: string;
  label: FaKey;
  type?: "text" | "tel" | "email" | "number";
  inputMode?: "numeric" | "tel" | "email" | "text";
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: FaKey;
  required?: boolean;
  autoComplete?: string;
  maxLength?: number;
  digits?: "fa";
  /** Example value shown while empty (design audit 2 Sep 2026: the «۰۹…» shape of a phone). Never a label. */
  placeholder?: string;
}): React.ReactNode {
  const id = useId();
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const described = [error === undefined ? null : errorId, hint === undefined ? null : hintId].filter(Boolean).join(" ");

  // the spec: a phone or postcode reads in Persian digits but is *stored* in Latin, so the
  // display is folded one way and every keystroke folded back before it leaves this component.
  const shown = digits === "fa" ? faDigits(value) : value;

  return (
    <div className={`field${error === undefined ? "" : " is-error"}`}>
      <label htmlFor={id}>
        {t(label)}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        value={shown}
        required={required}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={described === "" ? undefined : described}
        onChange={(e) => onChange(digits === "fa" ? enDigits(e.target.value) : e.target.value)}
        onBlur={onBlur}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="t-xs text-ink-3">
          {t(hint)}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="err flex items-center gap-1">
          <Icon name="close" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}
