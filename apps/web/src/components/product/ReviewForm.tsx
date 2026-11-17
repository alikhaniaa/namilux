"use client";
import { reviewSchema } from "@namilux/core/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/state/providers";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";

type Envelope = { ok: true; data: { id: string; status: "pending" } } | { ok: false; error: { code: string; message: string } };

const lines = (v: string): string[] | undefined => {
  const out = v
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, 5);
  return out.length === 0 ? undefined : out;
};

export function ReviewForm({ productId }: { productId: number }): React.ReactNode {
  const user = useUser();
  const pathname = usePathname();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pros, setPros] = useState("");
  const [cons, setCons] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [sent, setSent] = useState(false);

  if (user === null) {
    return (
      <p className="t-body">
        <Link className="link-under" href={`/account/login/?next=${encodeURIComponent(pathname)}`}>
          {t("product.reviews.login")}
        </Link>
      </p>
    );
  }

  if (sent) {
    return (
      <p className="t-body" role="status">
        {t("product.reviews.pending")}
      </p>
    );
  }

  const submit = async (): Promise<void> => {
    const parsed = reviewSchema.safeParse({
      rating,
      title,
      body,
      ...(lines(pros) === undefined ? {} : { pros: lines(pros) }),
      ...(lines(cons) === undefined ? {} : { cons: lines(cons) }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("form.required"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/products/${String(productId)}/reviews/`, {
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
      <div className="grid gap-1">
        <span className="t-sm text-ink-2">{t("product.reviews.rating")}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={t("product.reviews.rating")}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={rating === i}
              aria-label={t("product.reviews.avg", { n: i })}
              className={`p-1 ${i <= rating ? "text-ink" : "text-ink-4"}`}
              onClick={() => setRating(i)}
            >
              <Icon name="star" size={24} />
            </button>
          ))}
        </div>
      </div>
      <Field name="title" label="product.reviews.title" value={title} onChange={setTitle} maxLength={80} required />
      <Textarea name="body" label="product.reviews.body" value={body} onChange={setBody} maxLength={2000} rows={4} />
      <Textarea name="pros" label="product.reviews.pros" value={pros} onChange={setPros} maxLength={400} rows={2} />
      <Textarea name="cons" label="product.reviews.cons" value={cons} onChange={setCons} maxLength={400} rows={2} />
      {error !== undefined ? (
        <p className="t-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" loading={busy} disabled={busy}>
        {t("product.reviews.write")}
      </Button>
    </form>
  );
}
