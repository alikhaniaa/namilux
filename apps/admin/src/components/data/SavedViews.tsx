"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fa } from "@/i18n/fa";

type View = { key: string; label: string; query: string };

export function SavedViews({ presets, current }: { presets: View[]; current: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const storageKey = `nl.admin.views.${pathname}`;
  const [custom, setCustom] = useState<View[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setCustom(raw === null ? [] : (JSON.parse(raw) as View[]));
    } catch {
      setCustom([]);
    }
  }, [storageKey]);

  const persist = (views: View[]): void => {
    setCustom(views);
    try {
      localStorage.setItem(storageKey, JSON.stringify(views));
    } catch {
      /* private mode */
    }
  };

  // The live query minus the view marker: what a custom view would save, and what "default" compares against.
  const live = new URLSearchParams(sp.toString());
  live.delete("view");
  live.delete("page");
  const liveQuery = live.toString();
  const isDefault = current === "" && liveQuery === "";
  const all = [...presets, ...custom];

  return (
    <nav className="data-views" aria-label={fa["table.views"]}>
      <Link href={pathname} className="data-views__chip" aria-current={isDefault ? "page" : undefined}>
        {fa["views.default"]}
      </Link>
      {all.map((v) => {
        const isCustom = custom.includes(v);
        const active = current === v.key || (current === "" && liveQuery === v.query);
        return (
          <span key={v.key} className={`data-views__chip${active ? " is-active" : ""}`}>
            <Link href={`${pathname}?${v.query}&view=${encodeURIComponent(v.key)}`}>{v.label}</Link>
            {isCustom ? (
              <button type="button" className="data-views__remove" aria-label={fa["common.delete"]} onClick={() => persist(custom.filter((c) => c.key !== v.key))}>
                ×
              </button>
            ) : null}
          </span>
        );
      })}
      {liveQuery !== "" && current === "" && !naming ? (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setNaming(true)}>
          {fa["views.save"]}
        </button>
      ) : null}
      {naming ? (
        <form
          className="data-views__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() === "") return;
            persist([...custom, { key: `c-${String(Date.now())}`, label: name.trim(), query: liveQuery }]);
            setName("");
            setNaming(false);
          }}
        >
          <input className="ui-input" style={{ blockSize: "var(--ctl-h-sm)", inlineSize: "10rem" }} placeholder={fa["views.name"]} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="submit" className="ui-btn ui-btn--default ui-btn--sm">
            {fa["common.save"]}
          </button>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => setNaming(false)}>
            {fa["common.cancel"]}
          </button>
        </form>
      ) : null}
    </nav>
  );
}
