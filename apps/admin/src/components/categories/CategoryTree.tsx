"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronLeft, Plus } from "lucide-react";
import type { CategoryAdminInput } from "@namilux/core/client";
import { faDigits, CATEGORY_STATUSES, categoryAdminSchema, categoryUrl, enDigits, faInt } from "@namilux/core/client";
import { Form } from "@/components/forms/Form";
import { RichEditor } from "@/components/forms/RichEditor";
import { SeoFields } from "@/components/forms/SeoFields";
import { Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, StatusBadge } from "@/components/kit";
import { ConfirmButton, Dialog, toast } from "@/components/kit-client";
import { categoryStatusLabel, fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export type CategoryNode = { id: number; path: string; name: string; count: number; parentId: number | null; status: "active" | "hidden" | "archived"; inSitemap: boolean; robots: string; sort: number; children: CategoryNode[] };
export type CategoryFull = CategoryAdminInput & { legacy: boolean };

function flat(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flat(n.children, depth + 1)]);
}

export function CategoryTree({ title, tree, origin }: { title: string; tree: CategoryNode[]; origin: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<Set<number>>(new Set(tree.map((n) => n.id)));
  const [edit, setEdit] = useState<{ initial: CategoryFull; parentPath: string } | null>(null);
  const [redirectTo, setRedirectTo] = useState("/shop/");
  const all = flat(tree);
  const parents = all.map((x) => ({ id: x.node.id, name: `${"· ".repeat(x.depth)}${x.node.name}` }));

  function visible(n: CategoryNode, depth: number): boolean {
    if (depth === 0) return true;
    let cur: CategoryNode | undefined = all.find((x) => x.node.id === n.parentId)?.node;
    while (cur !== undefined) {
      if (!open.has(cur.id)) return false;
      cur = all.find((x) => x.node.id === cur?.parentId)?.node;
    }
    return true;
  }

  async function startEdit(id: number): Promise<void> {
    try {
      const initial = await api<CategoryFull>(`/api/categories/${String(id)}`);
      const parent = all.find((x) => x.node.id === initial.parentId)?.node;
      setEdit({ initial, parentPath: parent === undefined ? "" : parent.path });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }
  function startNew(parent: CategoryNode | null): void {
    setEdit({
      initial: { parentId: parent === null ? null : parent.id, slug: "", name: "", descriptionHtml: "", status: "active", inSitemap: true, sort: 0, seoTitle: null, seoDescription: null, robots: "index, follow", legacy: false },
      parentPath: parent === null ? "" : parent.path,
    });
  }
  async function archive(id: number): Promise<void> {
    try {
      await api(`/api/categories/${String(id)}`, { method: "POST", body: { archive: true, redirectTo: redirectTo.trim() === "" ? null : redirectTo.trim() } });
      toast(fa["common.saved"]);
      setEdit(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title={title}
        count={all.length}
        actions={
          <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => startNew(null)}>
            {fa["cat.new"]}
          </Button>
        }
      />
      {all.length === 0 ? (
        <EmptyState text={fa["table.empty"]} />
      ) : (
        <Card flush>
          <ul className="tree-list">
            {all.filter(({ node, depth }) => visible(node, depth)).map(({ node, depth }) => (
              <li key={node.id} className="tree-list__row" style={{ paddingInlineStart: `${String(0.75 + depth * 1.5)}rem` }}>
                {node.children.length > 0 ? (
                  <button type="button" className="tree-list__toggle" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; })} aria-label={open.has(node.id) ? fa["tree.collapse"] : fa["tree.expand"]} aria-expanded={open.has(node.id)}>
                    {open.has(node.id) ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
                  </button>
                ) : (
                  <span className="tree-list__leaf" aria-hidden="true" />
                )}
                <button type="button" className="tree-list__name" onClick={() => void startEdit(node.id)}>
                  {node.name}
                </button>
                {node.status !== "active" ? <StatusBadge tone="muted">{categoryStatusLabel(node.status)}</StatusBadge> : null}
                {!node.inSitemap ? <StatusBadge tone="warn">{fa["cat.notInSitemap"]}</StatusBadge> : null}
                {/* «{n} محصول» is a template - fill it (3 Sep 2026 walkthrough: it printed the raw placeholder) */}
                <span className="tree-list__count">{fa["cat.products"].replace("{n}", faInt(node.count))}</span>
                <Button size="icon-sm" variant="ghost" aria-label={`${fa["cat.new"]}: ${node.name}`} title={fa["cat.new"]} onClick={() => startNew(node)}>
                  <Plus size={16} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={edit?.initial.id === undefined ? fa["cat.new"] : fa["common.edit"]} wide>
        {edit !== null ? (
          <Form<CategoryFull>
            schemaKey="category"
            schema={categoryAdminSchema}
            initial={edit.initial}
            action={edit.initial.id === undefined ? "/api/categories" : `/api/categories/${String(edit.initial.id)}`}
            method={edit.initial.id === undefined ? "POST" : "PUT"}
            onSaved={() => {
              toast(fa["cat.saved"]);
              setEdit(null);
              router.refresh();
            }}
            extraActions={
              edit.initial.id !== undefined ? (
                <span className="flex items-center gap-1">
                  <Input dir="ltr" className="h-9 w-40 text-xs" value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)} />
                  <ConfirmButton label={fa["common.archive"]} confirmLabel={fa["common.confirm"]} onConfirm={() => archive(edit.initial.id ?? 0)} />
                </span>
              ) : undefined
            }
          >
            {(f) => {
              const v = f.values;
              const path = `${edit.parentPath === "" ? "" : `${edit.parentPath}/`}${v.slug}`;
              let preview = "/category/…/";
              try {
                preview = categoryUrl(path);
              } catch {
                /* incomplete slug */
              }
              return (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label={fa["cat.name"]} error={f.errors.name ?? ""}>
                      <Input value={v.name} onChange={(e) => f.set("name", e.target.value)} maxLength={120} />
                    </Field>
                    <Field label={fa["cat.parent"]}>
                      <Select value={v.parentId === null || v.parentId === undefined ? "" : String(v.parentId)} onChange={(e) => f.set("parentId", e.target.value === "" ? null : Number(e.target.value))}>
                        <option value="">{fa["cat.root"]}</option>
                        {parents.filter((p) => p.id !== v.id).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={fa["common.status"]}>
                      <Select value={v.status} onChange={(e) => f.set("status", e.target.value)}>
                        {CATEGORY_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {categoryStatusLabel(s)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={fa["cat.sort"]}>
                      <Input dir="ltr" inputMode="numeric" value={faDigits(v.sort)} onChange={(e) => f.set("sort", Number(enDigits(e.target.value)) || 0)} />
                    </Field>
                  </div>
                  <Checkbox label={fa["cat.inSitemap"]} checked={v.inSitemap} onChange={(e) => f.set("inSitemap", e.target.checked)} />
                  <RichEditor label={fa["cat.description"]} value={v.descriptionHtml} onChange={(h) => f.set("descriptionHtml", h)} allowImages={false} />
                  <SeoFields
                    entityKind="category"
                    legacySlug={edit.initial.legacy}
                    origin={origin}
                    values={{ seoTitle: v.seoTitle ?? "", seoDescription: v.seoDescription ?? "", robots: v.robots ?? "index, follow", slug: v.slug, path: preview }}
                    onChange={(p) => {
                      if (p.seoTitle !== undefined) f.set("seoTitle", p.seoTitle === "" ? null : p.seoTitle);
                      if (p.seoDescription !== undefined) f.set("seoDescription", p.seoDescription === "" ? null : p.seoDescription);
                      if (p.robots !== undefined) f.set("robots", p.robots);
                      if (p.slug !== undefined) f.set("slug", p.slug);
                    }}
                  />
                </div>
              );
            }}
          </Form>
        ) : null}
      </Dialog>
    </div>
  );
}
