"use client";
import { useEffect, useRef, useState } from "react";
import { faInt } from "@namilux/core/client";
import { Button, Input } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

type Group = { id: number; key: string; displayName: string; brandId: number | null; members: { id: number }[] };

/**
 * The product form's model-group box: search the groups of the selected brand, pick one, or create
 * one on the spot through the same guarded route the maintenance screens use (/api/products/models).
 *
 * The picker sits inside the product <form>, so Enter must never bubble into an implicit submit - 
 * it picks the first result instead, and the product's unsaved values are untouched either way.
 */
export function ModelGroupPicker({ value, brandId, onChange }: { value: number | null; brandId: number | null; onChange: (id: number | null) => void }) {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [current, setCurrent] = useState<Group | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  // The query effect must not re-run when the SELECTION changes (picking is not a new search), but
  // its response still has to resolve the newest selection - a ref keeps that value in reach.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    const timer = setTimeout(() => {
      void api<{ groups: Group[] }>(`/api/products/models?q=${encodeURIComponent(q)}${brandId === null ? "" : `&brandId=${String(brandId)}`}`)
        .then((r) => {
          if (cancelled) return;
          const list = Array.isArray(r.groups) ? r.groups : [];
          setGroups(list);
          const selected = valueRef.current;
          setCurrent((prev) => {
            if (selected === null) return null;
            const hit = list.find((g) => g.id === selected);
            if (hit !== undefined) return hit;
            return prev !== null && prev.id === selected ? prev : null;
          });
        })
        .catch(() => {
          if (!cancelled) { setGroups([]); setLoadFailed(true); }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, brandId]);

  // A cleared or different selection drops the stale group; the fetch above re-resolves a selection
  // it can see in the brand's list, and the id stays visible as `#id` when it cannot.
  useEffect(() => {
    let cancelled = false;
    setCurrent((prev) => (prev !== null && prev.id === value ? prev : null));
    if (value !== null) {
      void api<{ groups: Group[] }>(`/api/products/models?id=${String(value)}`)
        .then((r) => { if (!cancelled) setCurrent(r.groups.find((g) => g.id === value) ?? null); })
        .catch(() => { if (!cancelled) setLoadFailed(true); });
    }
    return () => { cancelled = true; };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(g: Group): void {
    onChange(g.id);
    setCurrent(g);
    setOpen(false);
    setQ("");
  }

  function clear(): void {
    onChange(null);
    setCurrent(null);
    setOpen(false);
    setQ("");
  }

  async function create(): Promise<void> {
    const name = q.trim();
    if (creating || name.length < 2) return;
    setCreating(true);
    try {
      const r = await api<{ id?: number }>("/api/products/models", { method: "POST", body: { name, brandId } });
      // The route answers `{ id }`; anything else means the group was not created.
      if (typeof r.id !== "number" || !Number.isInteger(r.id) || r.id <= 0) throw new ApiError("INTERNAL", fa["common.error"]);
      onChange(r.id);
      setCurrent({ id: r.id, key: "", displayName: name, brandId, members: [] });
      setOpen(false);
      setQ("");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setCreating(false);
    }
  }

  const typed = q.trim();

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {value !== null && !open ? (
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate border border-[var(--line)] px-2 py-1.5 text-sm">
            {current?.displayName ?? "گروه انتخاب‌شده"}
            {current !== null ? <span className="ms-2 text-xs text-[var(--ink-2)]">{faInt(current.members.length)}</span> : null}
          </span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {fa["common.edit"]}
          </Button>
          <Button size="sm" variant="ghost" aria-label={fa["products.model.clear"]} title={fa["products.model.clear"]} onClick={clear}>
            ×
          </Button>
        </span>
      ) : (
        <Input
          placeholder={fa["products.model.pick"]}
          aria-label={fa["products.model.searchLabel"]}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // This input lives inside the product <form>: Enter must never submit the product.
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            const first = groups[0];
            if (first !== undefined) pick(first);
          }}
        />
      )}
      {open ? (
        <ul aria-label={fa["products.model.searchLabel"]} className="absolute z-20 mt-1 max-h-56 w-full overflow-auto border border-[var(--line)] bg-[var(--surface)] text-sm shadow-pop">
          {groups.map((g) => (
            <li key={g.id}>
              <button type="button" className="flex w-full items-center justify-between px-2 py-1 text-start hover:bg-[var(--bg)]" onClick={() => pick(g)}>
                <span className="truncate">{g.displayName}</span>
                <span className="text-xs text-[var(--ink-2)]">{faInt(g.members.length)}</span>
              </button>
            </li>
          ))}
          {loading && groups.length === 0 ? <li className="px-2 py-1 text-xs text-[var(--ink-2)]">{fa["common.loading"]}</li> : null}
          {loadFailed ? <li role="alert" className="px-2 py-1 text-xs text-[var(--danger)]">گروه‌های کالا بارگذاری نشد. اتصال را بررسی کنید و دوباره جستجو کنید.</li> : null}
          {!loading && !loadFailed && groups.length === 0 && typed === "" ? <li className="px-2 py-1 text-xs text-[var(--ink-2)]">{fa["products.model.none"]}</li> : null}
          {!loading && !loadFailed && groups.length === 0 && typed.length >= 2 ? <li className="px-2 py-1 text-xs text-[var(--ink-2)]">{fa["products.model.noResults"]}</li> : null}
          {typed.length > 0 && typed.length < 2 ? <li className="px-2 py-1 text-xs text-[var(--ink-2)]">{fa["products.model.minChars"]}</li> : null}
          {typed.length >= 2 ? (
            <li>
              <button type="button" className="w-full px-2 py-1 text-start text-[var(--accent)] hover:bg-[var(--bg)]" disabled={creating} aria-busy={creating} onClick={() => void create()}>
                {creating ? fa["form.saving"] : `${fa["products.model.create"]}: ${typed}`}
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" className="w-full px-2 py-1 text-start text-xs text-[var(--ink-2)]" onClick={() => setOpen(false)}>
              {fa["common.close"]}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
