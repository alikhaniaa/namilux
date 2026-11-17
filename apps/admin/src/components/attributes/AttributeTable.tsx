"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { faDigits, ATTRIBUTE_KINDS, enDigits } from "@namilux/core/client";
import { Button, Checkbox, EmptyRow, Input, PageHeader, Select, Table, Td, Th } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type AttributeRow = { id?: number; key: string; label: string; unit: string | null; kind: "text" | "number" | "bool" | "color"; isFilterable: boolean; isComparable: boolean; sort: number };

const EMPTY: AttributeRow = { key: "", label: "", unit: null, kind: "text", isFilterable: false, isComparable: false, sort: 0 };

export function AttributeTable({ title, items }: { title: string; items: AttributeRow[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<AttributeRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (edit === null) return;
    setBusy(true);
    try {
      const { id, ...body } = edit;
      await api(id === undefined ? "/api/attributes" : `/api/attributes/${String(id)}`, { method: id === undefined ? "POST" : "PUT", body: { ...body, unit: body.unit === "" ? null : body.unit } });
      toast(fa["attributes.saved"]);
      setEdit(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  const row = (a: AttributeRow) =>
    edit !== null && edit.id === a.id ? (
      <tr key={a.id ?? "new"} className="border-t border-[var(--line)] bg-[var(--bg)]">
        <Td>
          <Input className="h-8" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
        </Td>
        <Td>
          <Input className="h-8 w-20" value={edit.unit ?? ""} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
        </Td>
        <Td>
          <Select className="h-8" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as AttributeRow["kind"] })}>
            {ATTRIBUTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {fa[`attributes.kind.${k}`]}
              </option>
            ))}
          </Select>
        </Td>
        <Td>
          <Checkbox label="" checked={edit.isFilterable} onChange={(e) => setEdit({ ...edit, isFilterable: e.target.checked })} />
        </Td>
        <Td>
          <Checkbox label="" checked={edit.isComparable} onChange={(e) => setEdit({ ...edit, isComparable: e.target.checked })} />
        </Td>
        <Td>
          <Input dir="ltr" className="h-8 w-16" value={faDigits(edit.sort)} onChange={(e) => setEdit({ ...edit, sort: Number(enDigits(e.target.value)) || 0 })} />
        </Td>
        <Td>
          <span className="flex gap-1">
            <Button size="sm" disabled={busy || edit.key.trim() === "" || edit.label.trim() === ""} onClick={() => void save()}>
              {fa["common.save"]}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
              {fa["common.cancel"]}
            </Button>
          </span>
        </Td>
      </tr>
    ) : (
      <tr key={a.id} className="border-t border-[var(--line)]">
        <Td>{a.label}</Td>
        <Td>{a.unit ?? "ثبت نشده"}</Td>
        <Td className="text-xs">{fa[`attributes.kind.${a.kind}`]}</Td>
        <Td>{a.isFilterable ? "✓" : "·"}</Td>
        <Td>{a.isComparable ? "✓" : "·"}</Td>
        <Td className="tabular-nums">{faDigits(a.sort)}</Td>
        <Td>
          <Button size="sm" variant="ghost" onClick={() => setEdit({ ...a })}>
            {fa["common.edit"]}
          </Button>
        </Td>
      </tr>
    );

  return (
    <div className="space-y-3">
      <PageHeader
        title={title}
        count={items.length}
        actions={
          <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEdit({ ...EMPTY, key: `attribute_${Date.now()}`, sort: items.length })} disabled={edit !== null}>
            {fa["attributes.new"]}
          </Button>
        }
      />
      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>{fa["attributes.label"]}</Th>
            <Th>{fa["attributes.unit"]}</Th>
            <Th>{fa["attributes.kind"]}</Th>
            <Th>{fa["attributes.filterable"]}</Th>
            <Th>{fa["attributes.comparable"]}</Th>
            <Th>{fa["cat.sort"]}</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {edit !== null && edit.id === undefined ? row(edit) : null}
          {items.map(row)}
          {items.length === 0 && edit === null ? <EmptyRow colSpan={7} text={fa["table.empty"]} /> : null}
        </tbody>
      </Table>
    </div>
  );
}
