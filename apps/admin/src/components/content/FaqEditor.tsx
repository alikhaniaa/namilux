"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { faDigits, enDigits, faInt } from "@namilux/core/client";
import { RichEditor } from "@/components/forms/RichEditor";
import { Button, Card, EmptyState, Field, Input, PageHeader, StatusBadge, Switch } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { FAQ } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

export type FaqRow = { id?: number; groupKey: string; question: string; answerHtml: string; sort: number; isActive: boolean };

/** The FAQ screen: its header (the «add» action lives there), then one sheet per group. */
export function FaqEditor({ title, items, groups }: { title: string; items: FaqRow[]; groups: string[] }) {
  const router = useRouter();
  const [edit, setEdit] = useState<FaqRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (edit === null) return;
    setBusy(true);
    try {
      await api("/api/faq", { method: "POST", body: edit });
      toast(fa["faq.saved"]);
      setEdit(null);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  const byGroup = new Map<string, FaqRow[]>();
  for (const it of items) byGroup.set(it.groupKey, [...(byGroup.get(it.groupKey) ?? []), it]);
  const add = () => setEdit({ groupKey: groups[0] ?? "general", question: "", answerHtml: "", sort: items.length, isActive: true });

  const editor = edit !== null && (
    <div className="inline-editor">
      <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_8rem]">
        <Field label={FAQ.groupLabel}>
          <Input dir="ltr" list="faq-groups" value={edit.groupKey} onChange={(e) => setEdit({ ...edit, groupKey: e.target.value })} />
        </Field>
        <datalist id="faq-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <Field label={FAQ.question}>
          <Input value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} maxLength={300} />
        </Field>
        <Field label={FAQ.sort}>
          <Input dir="ltr" inputMode="numeric" value={faDigits(edit.sort)} onChange={(e) => setEdit({ ...edit, sort: Number(enDigits(e.target.value)) || 0 })} />
        </Field>
      </div>
      <p className="inline-editor__hint">{FAQ.group}</p>
      <RichEditor label={fa["faq.answer"]} value={edit.answerHtml} onChange={(h) => setEdit({ ...edit, answerHtml: h })} allowImages={false} />
      <div className="inline-editor__foot">
        <Switch label={fa["faq.active"]} description={FAQ.active} checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
        <div className="inline-editor__actions">
          <Button variant="ghost" onClick={() => setEdit(null)}>
            {fa["common.cancel"]}
          </Button>
          <Button busy={busy} disabled={edit.question.trim().length < 3 || edit.groupKey.trim() === ""} onClick={() => void save()}>
            {fa["common.save"]}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        count={items.length}
        actions={
          <Button icon={<Plus size={16} aria-hidden="true" />} disabled={edit !== null} onClick={add}>
            {fa["faq.add"]}
          </Button>
        }
      />
      {edit !== null && edit.id === undefined ? <Card title={fa["faq.add"]}>{editor}</Card> : null}
      {items.length === 0 && edit === null ? <EmptyState text={fa["table.empty"]} /> : null}
      {Array.from(byGroup.entries()).map(([g, rows]) => (
        <Card key={g} title={`${fa["faq.group"]}: ${g}`} flush actions={<span className="ui-card__count">{faInt(rows.length)}</span>}>
          <ul className="row-list">
            {rows.map((r) =>
              edit !== null && edit.id === r.id ? (
                <li key={r.id} className="row-list__edit">
                  {editor}
                </li>
              ) : (
                <li key={r.id} className="row-list__row">
                  <span className="row-list__sort" title={FAQ.sort}>
                    {faInt(r.sort)}
                  </span>
                  <span className="row-list__main">{r.question}</span>
                  {!r.isActive ? <StatusBadge tone="muted">{fa["common.inactive"]}</StatusBadge> : null}
                  <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden="true" />} disabled={edit !== null} onClick={() => setEdit({ ...r })}>
                    {fa["common.edit"]}
                  </Button>
                </li>
              ),
            )}
          </ul>
        </Card>
      ))}
    </div>
  );
}
