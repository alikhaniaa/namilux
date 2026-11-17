"use client";
import { faInt } from "@namilux/core/client";
import { useId } from "react";
import { Icon } from "./Icon";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function Textarea({
  name,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  maxLength,
  rows = 3,
}: {
  name: string;
  label: FaKey;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  hint?: FaKey;
  maxLength?: number;
  rows?: number;
}): React.ReactNode {
  const id = useId();
  const errorId = `${id}-err`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const described = [error === undefined ? null : errorId, hint === undefined ? null : hintId, maxLength === undefined ? null : countId]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`field${error === undefined ? "" : " is-error"}`}>
      <label htmlFor={id}>{t(label)}</label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={described === "" ? undefined : described}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="t-xs text-ink-3">
          {t(hint)}
        </p>
      )}
      {maxLength === undefined ? null : (
        // Persian digits, like every other number in the UI. Polite, not assertive:
        // a counter that interrupts on every keystroke is worse than no counter.
        <p id={countId} className="t-xs text-ink-3" aria-live="polite">
          {faInt(value.length)}/{faInt(maxLength)}
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
