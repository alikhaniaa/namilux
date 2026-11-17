"use client";
import { questionSchema } from "@namilux/core/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhoneOtp } from "@/components/auth/PhoneOtp";
import { useUser } from "@/components/state/providers";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";

type Envelope = { ok: true; data: { id: string } } | { ok: false; error: { code: string; message: string } };

export function QuestionForm({ productId }: { productId: number }): React.ReactNode {
  const user = useUser();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p className="t-body" role="status">
        {t("product.questions.sent")}
      </p>
    );
  }

  if (user === null && !verified) {
    return (
      <div className="grid max-w-md gap-3">
        <p className="t-sm text-ink-2">{t("product.questions.login")}</p>
        <PhoneOtp
          purpose="login"
          compact
          onVerified={() => {
            // The session cookie is set; the provider's /api/me bootstrap picks it up on refresh.
            setVerified(true);
            router.refresh();
          }}
        />
      </div>
    );
  }

  const submit = async (): Promise<void> => {
    const parsed = questionSchema.safeParse({ body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("form.required"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/products/${String(productId)}/questions/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const env = (await res.json()) as Envelope;
      if (env.ok) {
        setSent(true);
        return;
      }
      setError(env.error.message);
    } catch {
      setError(t("checkout.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid max-w-xl gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Textarea name="body" label="product.questions.body" value={body} onChange={setBody} maxLength={1000} rows={3} />
      {error !== undefined ? (
        <p className="t-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
        {t("product.questions.ask")}
      </Button>
    </form>
  );
}
