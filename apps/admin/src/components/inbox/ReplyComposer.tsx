"use client";
import { useState } from "react";
import { enDigits, faInt } from "@namilux/core/client";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { Button, Checkbox, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { ApiError, api } from "@/lib/api-client";

export function smsSegments(text: string): number {
  const ucs2 = /[^ -~]/.test(text);
  const single = ucs2 ? 70 : 160;
  const multi = ucs2 ? 67 : 153;
  if (text.length === 0) return 0;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

export function ReplyComposer({
  id,
  kind,
  phone,
  onDone,
  allowPrice = false,
  allowFaq = false,
}: {
  id: string;
  kind: "concierge" | "question" | "contact";
  phone?: string;
  onDone?: () => void;
  allowPrice?: boolean;
  allowFaq?: boolean;
}) {
  const [answer, setAnswer] = useState("");
  const [sendSms, setSendSms] = useState(true);
  const [publish, setPublish] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [promote, setPromote] = useState(false);
  const [busy, setBusy] = useState(false);
  const segments = smsSegments(answer);
  const wa = phone === undefined ? null : `https://wa.me/98${enDigits(phone).replace(/^0/, "")}?text=${encodeURIComponent(answer)}`;

  async function send(): Promise<void> {
    setBusy(true);
    try {
      await api(`/api/inbox/${id}/reply`, {
        method: "POST",
        body: {
          kind,
          answer,
          sendSms,
          ...(allowPrice && publish && price !== null ? { publishPrice: price } : {}),
          ...(allowFaq ? { promoteToFaq: promote } : {}),
        },
      });
      toast(fa["inbox.replied"]);
      setAnswer("");
      onDone?.();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border border-[var(--line)] bg-[var(--bg)] p-3">
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={fa["inbox.message"]} rows={3} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Checkbox label={fa["inbox.sendSms"]} checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} />
        {allowFaq ? <Checkbox label={fa["inbox.promote"]} checked={promote} onChange={(e) => setPromote(e.target.checked)} /> : null}
        {allowPrice ? <Checkbox label={fa["inbox.publishPrice"]} checked={publish} onChange={(e) => setPublish(e.target.checked)} /> : null}
        <span className="text-[var(--ink-2)]">{fa["inbox.segments"].replace("{n}", faInt(segments))}</span>
      </div>
      {allowPrice && publish ? <MoneyInput label={fa["inbox.price"]} value={price} onChange={setPrice} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || answer.trim() === ""} onClick={() => void send()}>
          {fa["inbox.reply"]}
        </Button>
        {wa !== null ? (
          <a className="inline-flex h-7 items-center border border-[var(--line)] px-2 text-xs" href={wa} target="_blank" rel="noreferrer">
            {fa["inbox.whatsapp"]}
          </a>
        ) : null}
      </div>
    </div>
  );
}
