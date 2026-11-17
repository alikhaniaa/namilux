"use client";
import { statusLabel } from "@/i18n/admin-labels";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { faInt, formatJalali, formatToman } from "@namilux/core/client";
import { type Segment, SegmentBuilder } from "./SegmentBuilder";
import { smsSegments } from "@/components/inbox/ReplyComposer";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Checkbox, EmptyRow, Field, Input, StatusBadge, Table, Td, Textarea, Th } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { SMS } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";

type Preview = { recipients: number; segments: number; perMessage: number; estimate: number };
export type CampaignRow = { id: string; status: string; createdAt: string; finishedAt: string | null; name: string; text: string; budgetToman: number; dryRun: boolean; lastError: string | null };

export function SmsCampaignForm({ brands, history }: { brands: { id: number; name: string }[]; history: CampaignRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>({ optInOnly: true });
  const [text, setText] = useState("");
  const [budget, setBudget] = useState<number | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function doPreview(): Promise<void> {
    setBusy(true);
    try {
      setPreview(await api<Preview>("/api/sms-campaigns/preview", { method: "POST", body: { segment, text } }));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }
  async function send(): Promise<void> {
    if (budget === null) return;
    setBusy(true);
    try {
      await api("/api/sms-campaigns", { method: "POST", body: { name, segment, text, budgetToman: budget, dryRun } });
      toast(fa["sms.sent"]);
      setPreview(null);
      setName("");
      setText("");
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 border border-[var(--line)] p-3">
        <Field label={fa["sms.name"]} hint={SMS.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <SegmentBuilder value={segment} onChange={(s) => { setSegment(s); setPreview(null); }} brands={brands} />
        {/* SMS.text already says the unsubscribe line is appended, so it replaces fa["sms.unsub"];
            the counted suffix stays the one the preview route actually appends (UNSUBSCRIBE_LINE). */}
        <Field label={fa["sms.text"]} hint={`${SMS.text} · ${fa["inbox.segments"].replace("{n}", faInt(smsSegments(`${text} · لغو: لغو۱۱`)))}`}>
          <Textarea rows={3} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} maxLength={300} />
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <MoneyInput label={fa["sms.budget"]} hint={SMS.budget} value={budget} onChange={setBudget} />
          <div className="flex items-end pb-2">
            <Checkbox label={fa["sms.dryRun"]} checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Button variant="outline" disabled={busy || text.trim().length < 5} onClick={() => void doPreview()}>
              {fa["sms.preview"]}
            </Button>
            <Button disabled={busy || preview === null || name.trim() === "" || budget === null || budget <= 0} onClick={() => void send()}>
              {fa["sms.send"]}
            </Button>
          </div>
        </div>
        <p className="text-xs text-[var(--ink-2)]">
          {SMS.dryRun} {SMS.flow}
        </p>
        {preview !== null ? (
          <dl className="grid grid-cols-4 gap-2 border-t border-[var(--line)] pt-2 text-sm">
            <dt className="text-[var(--ink-2)]">{fa["sms.recipients"]}</dt>
            <dt className="text-[var(--ink-2)]">{fa["sms.segments"]}</dt>
            <dt className="text-[var(--ink-2)]">{fa["smsLog.cost"]}</dt>
            <dt className="text-[var(--ink-2)]">{fa["sms.cost"]}</dt>
            <dd className="tabular-nums">{faInt(preview.recipients)}</dd>
            <dd className="tabular-nums">{faInt(preview.segments)}</dd>
            <dd className="tabular-nums">{formatToman(preview.perMessage)}</dd>
            <dd className={`tabular-nums ${budget !== null && preview.estimate > budget ? "text-[var(--danger)]" : ""}`}>{formatToman(preview.estimate)}</dd>
          </dl>
        ) : null}
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">{fa["sms.history"]}</h2>
        <Table minWidth={720}>
          <thead>
            <tr>
              <Th>{fa["sms.name"]}</Th>
              <Th>{fa["sms.text"]}</Th>
              <Th>{fa["sms.budget"]}</Th>
              <Th>{fa["common.status"]}</Th>
              <Th>{fa["common.date"]}</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-[var(--line)] align-top">
                <Td>{h.name}</Td>
                <Td className="max-w-xs truncate text-xs text-[var(--ink-2)]">{h.text}</Td>
                <Td>{formatToman(h.budgetToman)}</Td>
                <Td>
                  <StatusBadge tone={h.status === "done" ? "ok" : h.status === "failed" ? "warn" : "default"}>{statusLabel(h.status)}</StatusBadge>
                  {h.dryRun ? <StatusBadge tone="muted">{fa["sms.dryRun"]}</StatusBadge> : null}
                  {h.lastError !== null ? <span className="block text-xs text-[var(--danger)]">{h.lastError}</span> : null}
                </Td>
                <Td className="text-xs">{formatJalali(h.finishedAt ?? h.createdAt, "short")}</Td>
              </tr>
            ))}
            {history.length === 0 ? <EmptyRow colSpan={5} text={fa["table.empty"]} /> : null}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
