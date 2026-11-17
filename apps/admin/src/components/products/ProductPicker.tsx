"use client";
import { useEffect, useState } from "react";
import { faInt, formatToman } from "@namilux/core/client";
import { Button, Input } from "@/components/kit";
import { fa } from "@/i18n/fa";
import { api } from "@/lib/api-client";

export type PickedProduct = { id: number; displayName: string; price: number; stockQty: number; stockPolicy: "track" | "untracked" };

export function ProductPicker({ onPick, label }: { onPick: (p: PickedProduct) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRows([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    let active = true;
    setRows([]);
    setLoading(true);
    setFailed(false);
    const id = setTimeout(() => {
      void api<{ rows: PickedProduct[] }>(`/api/products?q=${encodeURIComponent(q.trim())}&pageSize=10`)
        .then((r) => { if (active) setRows(r.rows); })
        .catch(() => { if (active) setFailed(true); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(id); };
  }, [q]);

  return (
    <div className="relative min-w-0 max-w-full">
      <div className="flex items-center gap-1">
        <Input className="h-8 w-64 max-w-full text-sm" aria-label={label ?? fa["products.search"]} placeholder={label ?? fa["products.search"]} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
        {q !== "" ? (
          <Button size="sm" variant="ghost" onClick={() => { setQ(""); setRows([]); }}>
            ×
          </Button>
        ) : null}
      </div>
      {open && q.trim().length >= 2 ? (
        <ul className="absolute inset-x-0 z-20 mt-1 max-h-64 w-full overflow-auto border border-[var(--line)] bg-[var(--surface)] text-sm shadow-pop">
          {loading ? <li role="status" className="p-2">در حال جستجوی کالا…</li> : failed ? <li role="alert" className="p-2">جستجو انجام نشد. اتصال اینترنت را بررسی کنید و نام کالا را دوباره بنویسید.</li> : rows.length === 0 ? <li role="status" className="p-2">کالایی پیدا نشد. نام یا کد کالا را بررسی کنید.</li> : null}
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2 py-1 text-start hover:bg-[var(--bg)]"
                onClick={() => {
                  onPick(p);
                  setOpen(false);
                  setQ("");
                  setRows([]);
                }}
              >
                <span className="truncate">{p.displayName}</span>
                <span className="shrink-0 text-xs text-[var(--ink-2)]">
                  {p.price === 0 ? fa["products.price.onRequest"] : formatToman(p.price)} · {p.stockPolicy === "untracked" ? "∞" : faInt(p.stockQty)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
