"use client";
import { returnRequestSchema } from "@namilux/core/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/state/toast-store";
import { t } from "@/i18n";

type Envelope = { ok: true; data: { id: string } } | { ok: false; error: { code: string; message: string } };

export function ReturnRequestForm({ orderCode, open, onClose }: { orderCode: string; open: boolean; onClose: () => void }): React.ReactNode {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    // The same schema the route parses, so the sheet never argues with the server about a length.
    const parsed = returnRequestSchema.safeParse({ orderCode, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("form.required"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/me/returns/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json()) as Envelope;
      if (body.ok) {
        toast.show({ key: "order.return.sent" });
        onClose();
        router.refresh();
        return;
      }
      setError(body.error.message);
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("order.return")}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="t-body text-ink-2">{t("order.return.note")}</p>
        <Textarea name="reason" label="order.return.reason" value={reason} onChange={setReason} maxLength={500} rows={4} {...(error === undefined ? {} : { error })} />
        <Button type="submit" variant="primary" block loading={busy} disabled={busy}>
          {t("order.return.submit")}
        </Button>
      </form>
    </Sheet>
  );
}
