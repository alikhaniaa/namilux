"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MENU_ITEM_KINDS, MENU_KEYS } from "@namilux/core/client";
import { Button, Input, Select } from "@/components/kit";
import { Tabs, toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { MENU } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

export type MenuItemRow = { label: string; kind: (typeof MENU_ITEM_KINDS)[number]; href?: string; ref?: string; badge?: string; children?: MenuItemRow[] };
type Menus = Record<string, MenuItemRow[]>;

function ItemRow({ item, depth, onChange, onRemove, onMove }: { item: MenuItemRow; depth: number; onChange: (i: MenuItemRow) => void; onRemove: () => void; onMove: (d: -1 | 1) => void }) {
  const kids = item.children ?? [];
  return (
    <li className="space-y-1">
      <div className="grid items-center gap-1 md:grid-cols-[1fr_8rem_1fr_6rem_auto]" style={{ paddingInlineStart: `${String(depth * 1.25)}rem` }}>
        <Input className="h-8" placeholder={fa["menus.label"]} aria-label={MENU.label} value={item.label} onChange={(e) => onChange({ ...item, label: e.target.value })} />
        <Select className="h-8" aria-label={MENU.kind} value={item.kind} onChange={(e) => { const { href: _h, ref: _r, ...rest } = item; void _h; void _r; onChange({ ...rest, kind: e.target.value as MenuItemRow["kind"] }); }}>
          {MENU_ITEM_KINDS.map((k) => (
            <option key={k} value={k}>
              {fa[`menus.kind.${k}`]}
            </option>
          ))}
        </Select>
        {item.kind === "url" ? (
          <Input dir="ltr" className="h-8" placeholder={MENU.href} aria-label={fa["menus.href"]} value={item.href ?? ""} onChange={(e) => onChange({ ...item, href: e.target.value })} />
        ) : (
          <Input dir="ltr" className="h-8" placeholder={MENU.ref} aria-label={fa["menus.ref"]} value={item.ref ?? ""} onChange={(e) => onChange({ ...item, ref: e.target.value })} />
        )}
        <Input className="h-8" placeholder={MENU.badge} aria-label={MENU.badge} value={item.badge ?? ""} onChange={(e) => { const { badge: _b, ...rest } = item; void _b; onChange(e.target.value === "" ? rest : { ...rest, badge: e.target.value }); }} />
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onMove(-1)} title={fa["menus.up"]} aria-label={fa["menus.up"]}>
            ↑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onMove(1)} title={fa["menus.down"]} aria-label={fa["menus.down"]}>
            ↓
          </Button>
          {depth < 2 ? (
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...item, children: [...kids, { label: "", kind: "url", href: "/" }] })} title={fa["menus.addChild"]} aria-label={fa["menus.addChild"]}>
              +
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onRemove} title={fa["menus.remove"]} aria-label={fa["menus.remove"]}>
            ×
          </Button>
        </span>
      </div>
      {kids.length > 0 ? (
        <ul className="space-y-1">
          {kids.map((c, i) => (
            <ItemRow
              key={i}
              item={c}
              depth={depth + 1}
              onChange={(n) => onChange({ ...item, children: kids.map((x, j) => (j === i ? n : x)) })}
              onRemove={() => onChange({ ...item, children: kids.filter((_, j) => j !== i) })}
              onMove={(d) => {
                const j = i + d;
                if (j < 0 || j >= kids.length) return;
                const n = [...kids];
                const a = n[i];
                const b = n[j];
                if (a && b) {
                  n[i] = b;
                  n[j] = a;
                }
                onChange({ ...item, children: n });
              }}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Persian names of the five menus; the tab strip showed the raw keys («header», «footer_shop»). */
const MENU_LABELS: Record<string, string> = {
  header: fa["menus.header"],
  drawer: fa["menus.drawer"],
  footer_shop: fa["menus.footerShop"],
  footer_help: fa["menus.footerHelp"],
  tabbar: fa["menus.tabbar"],
};
const menuLabel = (k: string): string => MENU_LABELS[k] ?? k;

export function MenuEditor({ menus }: { menus: Menus }) {
  const router = useRouter();
  const [key, setKey] = useState<string>(MENU_KEYS[0]);
  const [state, setState] = useState<Menus>(menus);
  const [busy, setBusy] = useState(false);
  const items = state[key] ?? [];
  const set = (next: MenuItemRow[]) => setState((s) => ({ ...s, [key]: next }));

  function clean(list: MenuItemRow[]): MenuItemRow[] {
    return list.map((i) => ({
      label: i.label,
      kind: i.kind,
      // A non-url item keeps its resolved `href` as well as its `ref`: rows that came from the seed
      // or the import carry only the href, and dropping it here left nothing for the server to store.
      ...(i.kind === "url"
        ? { href: i.href ?? "/" }
        : { ...(i.href ? { href: i.href } : {}), ...(i.ref ? { ref: i.ref } : {}) }),
      ...(i.badge ? { badge: i.badge } : {}),
      ...(i.children && i.children.length > 0 ? { children: clean(i.children) } : {}),
    }));
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/menus", { method: "PUT", body: { key, items: clean(items) } });
      toast(fa["menus.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--ink-2)]">{MENU.help}</p>
      <Tabs tabs={MENU_KEYS.map((k) => ({ key: k, label: menuLabel(k), count: (state[k] ?? []).length }))} current={key} onChange={setKey} />
      <ul className="space-y-1">
        {items.map((it, i) => (
          <ItemRow
            key={i}
            item={it}
            depth={0}
            onChange={(n) => set(items.map((x, j) => (j === i ? n : x)))}
            onRemove={() => set(items.filter((_, j) => j !== i))}
            onMove={(d) => {
              const j = i + d;
              if (j < 0 || j >= items.length) return;
              const n = [...items];
              const a = n[i];
              const b = n[j];
              if (a && b) {
                n[i] = b;
                n[j] = a;
              }
              set(n);
            }}
          />
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => set([...items, { label: "", kind: "url", href: "/" }])}>
          {fa["menus.add"]}
        </Button>
        <Button disabled={busy || items.some((i) => i.label.trim() === "")} onClick={() => void save()}>
          {fa["common.save"]}
        </Button>
      </div>
    </div>
  );
}
