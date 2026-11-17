"use client";
import { faInt, formatJalali } from "@namilux/core/client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { JalaliDate } from "@/components/forms/JalaliDate";
import { fa } from "@/i18n/fa";

/**
 * Design audit 2 Sep 2026: a `date` filter is the Jalali picker, not the browser's
 * Gregorian «mm/dd/yyyy». The picker is controlled and emits ISO; the hidden input carries that
 * ISO into the form's FormData, which the list pages already cast with `::timestamptz`.
 */
function DateFilter({ name, label, initial }: { name: string; label: string; initial: string }) {
  const [value, setValue] = useState<string | null>(initial === "" ? null : initial);
  return (
    <div className="data-filters__date">
      <span>{label}</span>
      <JalaliDate value={value} onChange={setValue} />
      <input type="hidden" name={name} value={value ?? ""} />
    </div>
  );
}

export type FilterDef = { key: string; label: string; kind: "select" | "multi" | "range" | "date" | "text" | "bool"; options?: { value: string; label: string }[] };

/** Server-side helper kept for pages that read a plain record: the values under the given keys. */
export function readFilters(sp: Record<string, string | string[] | undefined> | URLSearchParams, keys?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const entries: [string, string][] = sp instanceof URLSearchParams ? [...sp.entries()] : Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? "") : (v ?? "")]);
  for (const [k, v] of entries) if (v !== "" && (keys === undefined || keys.includes(k))) out[k] = v;
  return out;
}

const text = (entry: FormDataEntryValue | null): string => (typeof entry === "string" ? entry.trim() : "");

/** What an applied filter reads as in its chip: «وضعیت: پرداخت‌شده، ارسال‌شده». */
function chipValue(def: FilterDef, values: string[]): string {
  const label = (v: string): string => def.options?.find((o) => o.value === v)?.label ?? v;
  switch (def.kind) {
    case "multi":
    case "select":
      return values.map(label).join("، ");
    case "bool":
      return values[0] === "1" ? fa["common.yes"] : fa["common.no"];
    case "date": {
      const v = values[0] ?? "";
      const shown = formatJalali(v, "short");
      return shown === "" ? v : shown;
    }
    case "range": {
      const [min = "", max = ""] = (values[0] ?? "").split("-");
      const n = (s: string): string => (s === "" ? "…" : /^\d+$/.test(s) ? faInt(Number(s)) : s);
      return `${n(min)} – ${n(max)}`;
    }
    case "text":
      return `«${values[0] ?? ""}»`;
  }
}

/**
 * The list filter bar: the search box inline, every other filter in a panel behind «فیلترها», and
 * each applied filter as a chip that removes itself. The URL stays the one source of truth - the
 * same keys and values as before, so saved views, shared links and the server pages are unchanged.
 */
export function Filters({ defs }: { defs: FilterDef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchDef = defs.find((d) => d.kind === "text");
  const others = defs.filter((d) => d.kind !== "text");
  const activeOthers = others.filter((d) => params.getAll(d.key).some((v) => v !== ""));
  const [open, setOpen] = useState(false);

  const push = (sp: URLSearchParams): void => {
    sp.delete("page");
    sp.delete("view");
    const qs = sp.toString();
    router.push(qs === "" ? pathname : `${pathname}?${qs}`);
  };

  const apply = (form: HTMLFormElement): void => {
    const data = new FormData(form);
    const sp = new URLSearchParams(params.toString());
    for (const def of defs) {
      sp.delete(def.key);
      if (def.kind === "range") {
        const min = text(data.get(`${def.key}.min`));
        const max = text(data.get(`${def.key}.max`));
        if (min !== "" || max !== "") sp.set(def.key, `${min}-${max}`);
        continue;
      }
      for (const entry of data.getAll(def.key)) {
        const value = typeof entry === "string" ? entry.trim() : "";
        if (value !== "") sp.append(def.key, value);
      }
    }
    setOpen(false);
    push(sp);
  };

  const remove = (key: string): void => {
    const sp = new URLSearchParams(params.toString());
    sp.delete(key);
    push(sp);
  };

  const clear = (): void => {
    const sp = new URLSearchParams(params.toString());
    for (const def of defs) sp.delete(def.key);
    setOpen(false);
    push(sp);
  };

  const searchValue = searchDef === undefined ? "" : (params.get(searchDef.key) ?? "");
  const chips = [...(searchDef !== undefined && searchValue !== "" ? [searchDef] : []), ...activeOthers];

  return (
    <form
      className="data-filters"
      key={params.toString()}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
    >
      <div className="data-filters__row">
        {searchDef !== undefined ? (
          <label className="data-filters__search">
            <span className="sr-only">{searchDef.label}</span>
            <Search size={16} aria-hidden="true" />
            <input className="ui-input" type="search" name={searchDef.key} defaultValue={searchValue} placeholder={searchDef.label === fa["common.search"] ? fa["filters.searchHint"] : searchDef.label} autoComplete="off" />
          </label>
        ) : null}
        {others.length > 0 ? (
          <button type="button" className="ui-btn ui-btn--outline data-filters__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            {fa["common.filters"]}
            {activeOthers.length > 0 ? <span className="n">{faInt(activeOthers.length)}</span> : null}
          </button>
        ) : null}
      </div>
      {/* Hidden, not unmounted: the panel's controls keep their values in the form while it is shut. */}
      {others.length > 0 ? (
        <div className="data-filters__panel" hidden={!open}>
          <div className="data-filters__grid">
            {others.map((def) => {
              const current = params.get(def.key) ?? "";
              const all = params.getAll(def.key);
              if (def.kind === "date") {
                return <DateFilter key={def.key} name={def.key} label={def.label} initial={current} />;
              }
              if (def.kind === "multi") {
                const chosen = (def.options ?? []).filter((o) => all.includes(o.value));
                return (
                  <div key={def.key} className="data-filters__field">
                    <span>{def.label}</span>
                    <details className="data-filters__multi">
                      <summary>
                        <span>{chosen.length === 0 ? fa["filters.any"] : chosen.map((o) => o.label).join("، ")}</span>
                      </summary>
                      <div className="data-filters__menu">
                        {(def.options ?? []).map((o) => (
                          <label key={o.value}>
                            <input type="checkbox" name={def.key} value={o.value} defaultChecked={all.includes(o.value)} />
                            <span>{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              }
              if (def.kind === "range") {
                const [min = "", max = ""] = current.split("-");
                return (
                  <div key={def.key} className="data-filters__field">
                    <span>{def.label}</span>
                    <span className="flex gap-2">
                      <input className="ui-input ltr" name={`${def.key}.min`} inputMode="numeric" placeholder={fa["filters.from"]} defaultValue={min} aria-label={`${def.label} ${fa["filters.from"]}`} />
                      <input className="ui-input ltr" name={`${def.key}.max`} inputMode="numeric" placeholder={fa["filters.to"]} defaultValue={max} aria-label={`${def.label} ${fa["filters.to"]}`} />
                    </span>
                  </div>
                );
              }
              return (
                <label key={def.key} className="data-filters__field">
                  <span>{def.label}</span>
                  {def.kind === "select" ? (
                    <select className="ui-select" name={def.key} defaultValue={current}>
                      <option value="">{fa["filters.any"]}</option>
                      {(def.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select className="ui-select" name={def.key} defaultValue={current}>
                      <option value="">{fa["filters.any"]}</option>
                      <option value="1">{fa["common.yes"]}</option>
                      <option value="0">{fa["common.no"]}</option>
                    </select>
                  )}
                </label>
              );
            })}
          </div>
          <div className="data-filters__actions">
            <button type="submit" className="ui-btn ui-btn--default">
              {fa["filters.apply"]}
            </button>
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setOpen(false)}>
              {fa["common.cancel"]}
            </button>
            <span className="data-filters__spacer" />
            {chips.length > 0 ? (
              <button type="button" className="ui-btn ui-btn--ghost" onClick={clear}>
                {fa["table.clearFilters"]}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div className="data-chips" aria-label={fa["filters.active"]}>
          {chips.map((def) => (
            <span key={def.key} className="data-chip">
              <span>
                <b>{def.label}:</b> {chipValue(def, params.getAll(def.key))}
              </span>
              <button type="button" aria-label={`${fa["common.delete"]} ${def.label}`} onClick={() => remove(def.key)}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          ))}
          {chips.length > 1 ? (
            <button type="button" className="data-chips__clear" onClick={clear}>
              {fa["table.clearFilters"]}
            </button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
