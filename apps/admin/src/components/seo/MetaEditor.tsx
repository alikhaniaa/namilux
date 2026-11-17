"use client";
import { robotsLabel } from "@/i18n/admin-labels";
import { useEffect, useState } from "react";
import { ROBOTS_VALUES, faInt } from "@namilux/core/client";
import { Button, Input, Select, StatusBadge, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { META } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

type Kind = "product" | "category" | "brand" | "collection" | "post" | "page";
type Row = { kind: Kind; id: number; name: string; path: string; seoTitle: string | null; seoDescription: string | null; robots: string; flags: ("title_long" | "title_missing" | "description_missing" | "description_long")[] };

const KINDS: { key: Kind; label: string }[] = [
  { key: "product", label: fa["nav.products"] },
  { key: "category", label: fa["nav.categories"] },
  { key: "brand", label: fa["nav.brands"] },
  { key: "collection", label: fa["nav.collections"] },
  { key: "post", label: fa["nav.posts"] },
  { key: "page", label: fa["nav.pages"] },
];

export function MetaEditor({ origin }: { origin: string }) {
  const [kind, setKind] = useState<Kind>("product");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadError(false);
    const id = setTimeout(() => {
      void api<{ items: Row[] }>(`/api/seo/meta?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then((r) => { if (active) setRows(r.items); })
        .catch(() => { if (active) { setRows([]); setLoadError(true); } });
    }, 250);
    return () => { active = false; clearTimeout(id); };
  }, [kind, q]);

  async function save(): Promise<void> {
    if (edit === null) return;
    setBusy(true);
    try {
      await api("/api/seo/meta", { method: "PUT", body: { entity: edit.kind, id: edit.id, seoTitle: edit.seoTitle, seoDescription: edit.seoDescription, robots: edit.robots } });
      toast(fa["seo.saved"]);
      setRows((rs) => rs.map((r) => (r.id === edit.id ? edit : r)));
      setEdit(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {loadError ? <p role="alert" className="text-sm text-[var(--danger)]">فهرست صفحه‌ها بارگذاری نشد. اتصال را بررسی کنید و دوباره جستجو کنید یا صفحه را تازه کنید.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-40" aria-label={META.kind} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </Select>
        <Input className="w-72" placeholder={fa["seo.search"]} aria-label={META.search} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-[var(--ink-2)]">{fa["table.total"].replace("{n}", faInt(rows.length))}</span>
      </div>
      <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
        {rows.map((r) => (
          <li key={`${r.kind}-${String(r.id)}`} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <a href={`${origin}${r.path}`} target="_blank" rel="noreferrer" className="ltr break-all text-xs text-[var(--ink-2)] hover:text-[var(--accent)]">
                  {r.path}
                </a>
                {r.flags.map((f) => (
                  <StatusBadge key={f} tone="warn">
                    {fa[`seo.flag.${f}`]}
                  </StatusBadge>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setEdit(edit?.id === r.id ? null : { ...r })}>
                {fa["common.edit"]}
              </Button>
            </div>
            {edit !== null && edit.id === r.id ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="block text-xs">
                  <span className="text-[var(--ink-2)]">
                    {fa["seo.title"]} ({faInt((edit.seoTitle ?? "").length)}/۶۰)
                  </span>
                  <Input value={edit.seoTitle ?? ""} onChange={(e) => setEdit({ ...edit, seoTitle: e.target.value })} />
                  <span className="mt-1 block text-[var(--ink-2)]">{META.title}</span>
                </label>
                <label className="block text-xs">
                  <span className="text-[var(--ink-2)]">{fa["seo.robots"]}</span>
                  <Select value={edit.robots} onChange={(e) => setEdit({ ...edit, robots: e.target.value })}>
                    {/* an imported row keeps Yoast's longer string selected rather than silently becoming the first option */}
                    {(ROBOTS_VALUES as readonly string[]).includes(edit.robots) ? null : <option value={edit.robots}>{robotsLabel(edit.robots)}</option>}
                    {ROBOTS_VALUES.map((v) => (
                      <option key={v} value={v}>
                        {robotsLabel(v)}
                      </option>
                    ))}
                  </Select>
                  <span className="mt-1 block text-[var(--ink-2)]">{META.robots}</span>
                </label>
                <label className="block text-xs md:col-span-2">
                  <span className="text-[var(--ink-2)]">
                    {fa["seo.description"]} ({faInt((edit.seoDescription ?? "").length)}/۱۶۰)
                  </span>
                  <Textarea rows={2} value={edit.seoDescription ?? ""} onChange={(e) => setEdit({ ...edit, seoDescription: e.target.value })} />
                  <span className="mt-1 block text-[var(--ink-2)]">{META.description}</span>
                </label>
                <div className="flex gap-2 md:col-span-2">
                  <Button size="sm" disabled={busy} onClick={() => void save()}>
                    {fa["common.save"]}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                    {fa["common.cancel"]}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
        {rows.length === 0 ? <li className="p-6 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
      </ul>
    </div>
  );
}
