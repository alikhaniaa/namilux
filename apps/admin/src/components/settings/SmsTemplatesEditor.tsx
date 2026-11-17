"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SMS_TEMPLATES, faInt } from "@namilux/core/client";
import { smsSegments } from "@/components/inbox/ReplyComposer";
import { Button, StatusBadge, Textarea } from "@/components/kit";
import { toast } from "@/components/kit-client";
import { fa } from "@/i18n/fa";
import { SMS_TEMPLATE_LABEL, SMS_TEMPLATES_HELP } from "@/i18n/admin-guidance";
import { ApiError, api } from "@/lib/api-client";
import { displaySmsTemplate, storedSmsTemplate, smsVariableLabel } from "@/lib/sms-template-text";

function vars(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/\{([a-zA-Z_]+)\}/g), (m) => m[1] ?? ""))).filter((v) => v !== "");
}

export function SmsTemplatesEditor({ initial, defaults }: { initial: Record<string, string>; defaults: Record<string, string> }) {
  const router = useRouter();
  const [value, setValue] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await api("/api/settings/sms.templates", { method: "PUT", body: { value } });
      toast(fa["settings.saved"]);
      router.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : fa["common.error"], "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--ink-2)]">{SMS_TEMPLATES_HELP}</p>
      {SMS_TEMPLATES.map((key) => {
        const text = value[key] ?? defaults[key] ?? "";
        const expected = vars(defaults[key] ?? "");
        const present = vars(text);
        const missing = expected.filter((v) => !present.includes(v));
        const seg = smsSegments(text);
        return (
          <div key={key} className="space-y-1 border border-[var(--line)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {SMS_TEMPLATE_LABEL[key] ?? "قالب پیامک"}
              </span>
              <span className="flex flex-wrap gap-1 text-xs">
                {expected.map((v) => (
                  <StatusBadge key={v} tone={missing.includes(v) ? "warn" : "muted"}>
                    <span>{smsVariableLabel(v)}</span>
                  </StatusBadge>
                ))}
                <StatusBadge tone={seg > 2 ? "warn" : "default"}>{fa["smsTpl.segments"].replace("{n}", faInt(seg))}</StatusBadge>
              </span>
            </div>
            <Textarea rows={2} aria-label={SMS_TEMPLATE_LABEL[key] ?? "قالب پیامک"} value={displaySmsTemplate(text)} onChange={(e) => setValue((v) => ({ ...v, [key]: storedSmsTemplate(e.target.value) }))} />
            {missing.length > 0 ? <p className="text-xs text-[var(--danger)]">{fa["smsTpl.missingVar"].replace("{v}", missing.map(smsVariableLabel).join("، "))}</p> : null}
            {text.length > 320 ? <p className="text-xs text-[var(--danger)]">متن بیش از ۳۲۰ نویسه است؛ آن را کوتاه‌تر کنید.</p> : null}
          </div>
        );
      })}
      <Button disabled={busy || SMS_TEMPLATES.some(key => {
        const text = value[key] ?? defaults[key] ?? "";
        return text.length > 320 || vars(defaults[key] ?? "").some(v => !vars(text).includes(v));
      })} onClick={() => void save()}>
        {fa["common.save"]}
      </Button>
    </div>
  );
}
