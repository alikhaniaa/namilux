"use client";
import { faNorm } from "@namilux/core/client";
import { useId, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

export function Select({
  name,
  label,
  value,
  options,
  onChange,
  error,
  placeholder,
  disabled = false,
  searchable = false,
}: {
  name: string;
  label: FaKey;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  error?: string;
  placeholder?: FaKey;
  disabled?: boolean;
  searchable?: boolean;
}): React.ReactNode {
  const id = useId();
  const errorId = `${id}-err`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = options.find((o) => o.value === value);

  // DECISION: the searchable variant is a Sheet with a filter, not a combobox. 2,705 cities in a
  // native <select> is unusable on a phone, and a custom listbox would have to re-implement the
  // platform behaviour the plain control already gives us for every other field.
  if (searchable) {
    const needle = faNorm(query);
    const shown = needle === "" ? options : options.filter((o) => faNorm(o.label).includes(needle));
    return (
      <div className={`field${error === undefined ? "" : " is-error"}`}>
        <label htmlFor={id}>{t(label)}</label>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-describedby={error === undefined ? undefined : errorId}
          className="flex h-12 items-center justify-between border border-line-input bg-surface px-3.5 text-start"
          onClick={() => setOpen(true)}
        >
          {current?.label ?? (placeholder === undefined ? "" : t(placeholder))}
          <Icon name="chevron-s" size={20} />
        </button>
        {error === undefined ? null : (
          <p id={errorId} className="err">
            {error}
          </p>
        )}
        <Sheet open={open} onClose={() => setOpen(false)} title={t(label)} size="full">
          <div className="field">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("shell.search.placeholder")}
              aria-label={t("shell.search")}
            />
          </div>
          <ul className="mt-3">
            {shown.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className="hairline-b flex h-13 w-full items-center text-start"
                  aria-current={o.value === value ? "true" : undefined}
                  onClick={() => {
                    onChange(o.value);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      </div>
    );
  }

  return (
    <div className={`field${error === undefined ? "" : " is-error"}`}>
      <label htmlFor={id}>{t(label)}</label>
      <div className="relative">
        <select
          id={id}
          name={name}
          value={value}
          disabled={disabled}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none pe-10"
        >
          {placeholder === undefined ? null : <option value="">{t(placeholder)}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Decorative: the native control still opens on click anywhere in the box. */}
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-3">
          <Icon name="chevron-s" size={20} />
        </span>
      </div>
      {error === undefined ? null : (
        <p id={errorId} className="err">
          {error}
        </p>
      )}
    </div>
  );
}
