"use client";
import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { faInt } from "@namilux/core/client";

type Option = { id: number; name: string };
const normalize = (s: string): string => s.replace(/ي/gu, "ی").replace(/ك/gu, "ک").replace(/\u200c/gu, " ").toLocaleLowerCase("fa").trim();

/** Searchable multi-selection with native disclosure and checkbox keyboard behaviour. */
export function SearchMultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: readonly number[]; onChange: (ids: number[]) => void }) {
  const [search, setSearch] = useState("");
  const disclosure = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const query = normalize(search);
  const filtered = useMemo(() => options.filter((o) => normalize(o.name).includes(query)), [options, query]);
  const selected = options.filter((o) => value.includes(o.id));
  const change = (key: number, checked: boolean): void => onChange(checked ? [...new Set([...value, key])] : value.filter((v) => v !== key));
  const close = (): void => {
    if (disclosure.current) {
      disclosure.current.open = false;
      disclosure.current.querySelector("summary")?.focus();
    }
  };
  return (
    <div className="selection-field" role="group" aria-label={label}>
      <details ref={disclosure} className="selection-picker" onToggle={(e) => { if (e.currentTarget.open) input.current?.focus(); }} onKeyDown={(e) => {
        if (e.key === "Escape" && disclosure.current?.open) { e.preventDefault(); close(); }
      }}>
        <summary className="selection-picker__trigger">
          <span>{value.length === 0 ? `انتخاب ${label}` : `${faInt(value.length)} مورد انتخاب شده`}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="selection-picker__panel">
          <label className="selection-picker__search" htmlFor={id}>
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">جستجو در {label}</span>
            <input ref={input} id={id} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام مورد نظر را جستجو کنید…" autoComplete="off" />
          </label>
          <div className="selection-picker__options">
            {filtered.map((o) => <label key={o.id} className="selection-picker__option">
              <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => change(o.id, e.target.checked)} />
              <span>{o.name}</span>
            </label>)}
            {filtered.length === 0 ? <p className="selection-picker__empty" role="status">موردی پیدا نشد. عبارت دیگری را امتحان کنید.</p> : null}
          </div>
          <button type="button" className="ui-btn ui-btn--soft" onClick={close}>تأیید انتخاب‌ها</button>
        </div>
      </details>
      {selected.length > 0 ? <ul className="selection-chips" aria-label="موارد انتخاب‌شده">
        {selected.map((o) => <li key={o.id}><span>{o.name}</span><button type="button" aria-label={`حذف ${o.name} از انتخاب‌ها`} onClick={() => change(o.id, false)}><X size={14} aria-hidden="true" /></button></li>)}
      </ul> : null}
    </div>
  );
}
