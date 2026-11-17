"use client";
import { useId, useMemo } from "react";
import { SearchMultiSelect } from "./SearchMultiSelect";
export type TreeNode = { id: number; name: string; children: TreeNode[] };
export function TreePicker({ tree, selected, primary, onChange }: { tree: TreeNode[]; selected: number[]; primary: number | null; onChange: (selected: number[], primary: number | null) => void }) {
  const id = useId();
  const options = useMemo(() => {
    const rows: { id: number; name: string }[] = [];
    const walk = (nodes: TreeNode[], parents: string[]): void => {
      for (const node of nodes) { const path = [...parents, node.name]; rows.push({ id: node.id, name: path.join(" / ") }); walk(node.children, path); }
    };
    walk(tree, []);
    return rows;
  }, [tree]);
  return <div className="category-picker">
    <SearchMultiSelect label="دسته‌بندی" options={options} value={selected} onChange={(ids) => onChange(ids, primary !== null && ids.includes(primary) ? primary : ids[0] ?? null)} />
    {selected.length > 1 ? <div className="category-picker__primary">
      <label htmlFor={id}>دسته‌بندی اصلی محصول</label>
      <select id={id} className="ui-select" value={primary ?? selected[0]} onChange={(e) => onChange(selected, Number(e.target.value))}>
        {options.filter((o) => selected.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <p className="ui-field__hint">این دسته در مسیر محصول و اطلاعات ارسالی به موتورهای جستجو استفاده می‌شود.</p>
    </div> : null}
  </div>;
}
