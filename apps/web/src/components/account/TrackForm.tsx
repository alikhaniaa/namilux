"use client";
import type { OrderTrackView } from "@namilux/core/client";
import { faInt, formatToman, normalizePhone, trackRequestSchema } from "@namilux/core/client";
import { useState } from "react";
import { ORDER_STATUS_KEY } from "./order-status";
import { OrderTimeline } from "./OrderTimeline";
import { Bdi } from "@/components/ui/Bdi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { t } from "@/i18n";

type TrackResult = OrderTrackView;
type Envelope = { ok: true; data: TrackResult } | { ok: false; error: { code: string; message: string } };

export function TrackForm(): React.ReactNode {
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<TrackResult | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = trackRequestSchema.safeParse({ code, phone: normalizePhone(phone) ?? phone });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("form.required"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/orders/track/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json()) as Envelope;
      if (body.ok) {
        setResult(body.data);
        return;
      }
      setResult(null);
      setError(body.error.code === "NOT_FOUND" ? t("track.notFound") : body.error.message);
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const unit = t("product.price.unit");
  const statusKey = result === null ? null : ORDER_STATUS_KEY[result.status];

  return (
    <div className="grid gap-8">
      <form
        className="grid max-w-md gap-4"
        noValidate
        aria-busy={busy || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field name="code" label="track.code" value={code} onChange={(v) => setCode(v.toUpperCase())} autoComplete="off" maxLength={12} />
        <Field name="phone" label="track.phone" type="tel" inputMode="tel" digits="fa" value={phone} onChange={setPhone} autoComplete="tel" maxLength={11} />
        {error !== undefined ? (
          <p className="t-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" loading={busy} disabled={busy}>
          {t("track.submit")}
        </Button>
      </form>

      {result !== null && statusKey !== null ? (
        <section className="grid gap-6" aria-live="polite">
          <header className="grid gap-1">
            <h2 className="d-3">{t("track.result", { code: result.code })}</h2>
            <p className="t-sm text-ink-2">{t(statusKey)}</p>
          </header>
          <OrderTimeline steps={result.timeline} />
          <ul className="grid gap-2 t-sm">
            {result.items.map((it) => (
              <li key={it.id} className="hairline-t flex items-center justify-between gap-3 py-2">
                <span>
                  <Bdi text={it.name} /> <span className="text-ink-3">×{faInt(it.qty)}</span>
                </span>
                <span className="tnum">
                  {formatToman(it.lineTotal)} {unit}
                </span>
              </li>
            ))}
          </ul>
          <p className="t-body font-semibold">
            {t("cart.summary.total")}: {formatToman(result.grandTotal)} {unit}
          </p>
        </section>
      ) : null}
    </div>
  );
}
