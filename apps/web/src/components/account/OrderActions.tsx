"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReturnRequestForm } from "./ReturnRequestForm";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/state/toast-store";
import { t } from "@/i18n";

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function OrderActions({
  code,
  canCancel,
  canReturn,
  canRetryPayment,
  payLabel,
}: {
  code: string;
  canCancel: boolean;
  canReturn: boolean;
  canRetryPayment: boolean;
  payLabel?: string;
}): React.ReactNode {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "cancel" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const path = `/api/me/orders/${encodeURIComponent(code)}/`;

  const retry = async (): Promise<void> => {
    setBusy("retry");
    setError(undefined);
    try {
      const res = await fetch(`${path}/retry/`, { method: "POST" });
      const body = (await res.json()) as Envelope<{ redirectUrl: string }>;
      if (body.ok) {
        window.location.assign(body.data.redirectUrl);
        return;
      }
      setError(body.error.message);
    } catch {
      setError(t("checkout.error.gateway"));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy("cancel");
    setError(undefined);
    try {
      const res = await fetch(`${path}/cancel/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderCode: code, ...(reason.trim() === "" ? {} : { reason: reason.trim() }) }),
      });
      const body = (await res.json()) as Envelope<{ status: string }>;
      if (body.ok) {
        toast.show({ key: "order.cancel.done" });
        setCancelling(false);
        router.refresh();
        return;
      }
      setError(body.error.message);
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(null);
    }
  };

  if (!canCancel && !canReturn && !canRetryPayment) return null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {canRetryPayment ? (
          <Button variant="primary" loading={busy === "retry"} disabled={busy !== null} onClick={() => void retry()}>
            {payLabel ?? t("order.payAgain")}
          </Button>
        ) : null}
        {canReturn ? (
          <Button variant="secondary" onClick={() => setReturning(true)}>
            {t("order.return")}
          </Button>
        ) : null}
        {canCancel && !cancelling ? (
          <Button variant="quiet" onClick={() => setCancelling(true)}>
            {t("order.cancel")}
          </Button>
        ) : null}
      </div>
      {cancelling ? (
        <form
          className="card grid gap-3 p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void cancel();
          }}
        >
          <p className="t-body font-semibold">{t("order.cancel.confirm")}</p>
          <Textarea name="reason" label="order.cancel.reason" value={reason} onChange={setReason} maxLength={300} rows={2} />
          <div className="flex gap-3">
            <Button type="submit" variant="secondary" loading={busy === "cancel"} disabled={busy !== null}>
              {t("order.cancel")}
            </Button>
            <Button variant="quiet" onClick={() => setCancelling(false)}>
              {t("shell.back")}
            </Button>
          </div>
        </form>
      ) : null}
      {error !== undefined ? (
        <p className="t-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <ReturnRequestForm orderCode={code} open={returning} onClose={() => setReturning(false)} />
    </div>
  );
}
