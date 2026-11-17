"use client";
import { normalizePhone } from "@namilux/core/client";
import type { PowChallenge as Challenge, PowSolution } from "@namilux/integrations/captcha";
import { useState } from "react";
import { PowChallenge } from "@/components/auth/PowChallenge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { t } from "@/i18n";

type Status = "idle" | "captcha" | "submitting" | "sent" | "error";
type ChallengeResponse = { ok: true; data: { challenge: Challenge } } | { ok: false; error: { code: string; message: string } };
type SubscribeResponse = { ok: true; data: { status: "subscribed" | "already" } } | { ok: false; error: { code: string; message: string } };

function encodePow(sol: PowSolution): string {
  const json = JSON.stringify(sol);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function NewsletterForm(): React.ReactNode {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  const send = async (powToken?: string): Promise<void> => {
    try {
      if (powToken === undefined) {
        const res = await fetch("/api/newsletter/", { headers: { accept: "application/json" } });
        const body = (await res.json()) as ChallengeResponse;
        if (!body.ok) {
          setStatus("error");
          setError(body.error.message);
          return;
        }
        setChallenge(body.data.challenge);
        setStatus("captcha");
        return;
      }
      const res = await fetch("/api/newsletter/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(phone) ?? phone, optIn: true, powToken }),
      });
      const body = (await res.json()) as SubscribeResponse;
      if (body.ok) {
        setStatus("sent");
        return;
      }
      setStatus("error");
      setError(body.error.message);
    } catch {
      setStatus("error");
      setError(t("checkout.error.generic"));
    }
  };

  const submit = (): void => {
    // DECISION (perf): the form checks the number with the pure `normalizePhone` instead of the zod
    // schema. This island sits in the footer of every page, and importing any schema from the client
    // barrel pulled the whole zod runtime (64 KB gz) into the shell bundle of every route; the route
    // still validates the body with `newsletterSchema` server-side, so nothing is trusted less.
    if (phone.trim() === "") {
      setError(t("form.required"));
      return;
    }
    if (normalizePhone(phone) === null) {
      setError(t("form.phone.invalid"));
      return;
    }
    setError(undefined);
    setStatus("submitting");
    void send();
  };

  if (status === "sent") {
    return (
      <p className="t-sm text-frame-ink" role="status">
        {t("footer.newsletter.done")}
      </p>
    );
  }

  return (
    <form
      className="grid gap-3"
      noValidate
      aria-busy={status === "submitting" || status === "captcha" || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {status === "captcha" && challenge !== null ? (
        <PowChallenge
          challenge={challenge}
          onSolved={(sol) => {
            setStatus("submitting");
            void send(encodePow(sol));
          }}
        />
      ) : null}
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field name="newsletter-phone" label="footer.newsletter.phone" type="tel" inputMode="tel" digits="fa" value={phone} onChange={setPhone} autoComplete="tel" maxLength={11} {...(error === undefined ? {} : { error })} />
        </div>
        <Button type="submit" variant="secondary" loading={status === "submitting" || status === "captcha"} disabled={status === "submitting" || status === "captcha"}>
          {t("footer.newsletter.join")}
        </Button>
      </div>
    </form>
  );
}
