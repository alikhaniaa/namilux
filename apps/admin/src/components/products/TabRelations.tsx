"use client";
import Link from "next/link";
import { useState } from "react";
import type { ProductAdminInput, ProductCard } from "@namilux/core/client";
import { formatToman } from "@namilux/core/client";
import { ProductPicker } from "./ProductPicker";
import type { FormApi } from "@/components/forms/Form";
import { Button, Select, StatusBadge } from "@/components/kit";
import { fa } from "@/i18n/fa";

type Rel = ProductAdminInput["relations"][number];
type EditKind = "related" | "accessory" | "replacement";
const KINDS: EditKind[] = ["related", "accessory", "replacement"];
const kindLabel = (k: Rel["kind"]): string => (k === "same_model" ? fa["products.model.siblings"] : fa[`products.relations.${k}`]);

export function TabRelations({ f, names, siblings }: { f: FormApi<ProductAdminInput>; names: Record<number, string>; siblings: ProductCard[] }) {
  const [local, setLocal] = useState<Record<number, string>>(names);
  const [kind, setKind] = useState<EditKind>("related");
  const rels = f.values.relations;
  function update(next: Rel[]): void {
    f.set("relations", next.map((r, i) => ({ ...r, sort: i })));
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
          {rels.map((r, i) => (
            <li key={`${String(r.relatedId)}-${r.kind}`} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <Link href={`/products/${String(r.relatedId)}`} className="truncate hover:text-[var(--accent)]">
                {local[r.relatedId] ?? "مشاهدهٔ کالا"}
              </Link>
              <Select className="h-7 w-32 text-xs" value={r.kind} onChange={(e) => update(rels.map((x, j) => (j === i ? { ...x, kind: e.target.value as Rel["kind"] } : x)))}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" onClick={() => update(rels.filter((_, j) => j !== i))}>
                ×
              </Button>
            </li>
          ))}
          {rels.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["table.empty"]}</li> : null}
        </ul>
        <div className="flex items-center gap-2">
          <Select className="h-8 w-32 text-xs" value={kind} onChange={(e) => setKind(e.target.value as EditKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </Select>
          <ProductPicker
            label={fa["products.relations.add"]}
            onPick={(p) => {
              if (p.id === f.values.id || rels.some((r) => r.relatedId === p.id && r.kind === kind)) return;
              setLocal((l) => ({ ...l, [p.id]: p.displayName }));
              update([...rels, { relatedId: p.id, kind, sort: rels.length }]);
            }}
          />
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">{fa["products.model.siblings"]}</h3>
        <ul className="divide-y divide-[var(--line)] border border-[var(--line)] text-sm">
          {siblings.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <Link href={`/products/${String(s.id)}`} className="truncate hover:text-[var(--accent)]">
                {s.displayName}
              </Link>
              {s.colorName !== undefined ? <StatusBadge tone="muted">{s.colorName}</StatusBadge> : null}
              <span className="text-xs text-[var(--ink-2)]">{s.onRequest ? fa["products.price.onRequest"] : formatToman(s.price)}</span>
            </li>
          ))}
          {siblings.length === 0 ? <li className="p-4 text-center text-[var(--ink-2)]">{fa["products.model.none"]}</li> : null}
        </ul>
      </section>
    </div>
  );
}
