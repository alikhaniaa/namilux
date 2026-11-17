"use client";
import { contactSchema } from "@namilux/core/client";
import type { PowChallenge as Challenge, PowSolution } from "@namilux/integrations/captcha";
import { useState } from "react";
import { PowChallenge } from "@/components/auth/PowChallenge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";

type Status = "idle" | "submitting" | "captcha" | "sent" | "error";
type FieldName = "name" | "phone" | "message";
type Errors = Record<FieldName, string | undefined>;

const NO_ERRORS: Errors = { name: undefined, phone: undefined, message: undefined };

/** `exactOptionalPropertyTypes` is on: an absent error is an absent prop, not `error={undefined}`. */
const errorProp = (message: string | undefined): { error?: string } => (message === undefined ? {} : { error: message });

/** The envelope of the spec - narrowed by hand because a parsed body is untrusted input. */
type ContactResponse = { ok: true; data: { id: string } } | { ok: false; error: { code: string; message: string } };
type ChallengeResponse = { ok: true; data: { challenge: Challenge } } | { ok: false; error: { code: string; message: string } };

/** The same base64url(JSON) carrier the OTP flow uses (auth/PhoneOtp), read back by lib/otp-config.parsePowToken. */
function encodePow(sol: PowSolution): string {
  const json = JSON.stringify(sol);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// DECISION: the field rules are read off `contactSchema` itself rather than re-typed here, so the
// browser and the route can never disagree about what a valid message is (the spec: client
// islands validate with the same zod schemas). The Persian sentence shown is the schema's own
// message - the spec §validation calls those strings "the field-level copy" - except for a blank
// field, which reads «این فیلد لازم است» from fa.ts instead of «متن کوتاه‌تر از حد مجاز است».
function fieldError(name: FieldName, value: string): string | undefined {
  if (value.trim() === "") return t("form.required");
  const result = contactSchema.shape[name].safeParse(value);
  if (result.success) return undefined;
  return result.error.issues[0]?.message ?? t("form.required");
}

export function ContactForm(): React.ReactNode {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  const values: Record<FieldName, string> = { name, phone, message };
  const blur = (f: FieldName): void => {
    // Validate on blur, never on every keystroke: the error appears once the
    // shopper has finished with the field, not while they are still typing into it.
    setErrors((prev) => ({ ...prev, [f]: fieldError(f, values[f]) }));
  };

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status === "submitting") return;

    const next: Errors = {
      name: fieldError("name", name),
      phone: fieldError("phone", phone),
      message: fieldError("message", message),
    };
    setErrors(next);
    if (next.name !== undefined || next.phone !== undefined || next.message !== undefined) {
      setStatus("idle");
      setFormError("");
      return;
    }

    setStatus("submitting");
    setFormError("");
    await send();
  }

  /**
   * the spec: the form is behind a self-hosted proof of work. The first attempt fetches a
   * challenge (GET /api/contact), the solver runs in the browser, and the solved token travels in
   * the body as `powToken` - the field contactSchema requires.
   */
  async function send(powToken?: string): Promise<void> {
    try {
      if (powToken === undefined) {
        const res = await fetch("/api/contact/", { headers: { accept: "application/json" } });
        const body = (await res.json()) as ChallengeResponse;
        if (!body.ok) {
          setStatus("error");
          setFormError(body.error.message !== "" ? body.error.message : t("checkout.error.generic"));
          return;
        }
        setChallenge(body.data.challenge);
        setStatus("captcha");
        return;
      }
      const res = await fetch("/api/contact/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, message, powToken }),
      });
      const body = (await res.json()) as ContactResponse;
      if (res.ok && body.ok) {
        setStatus("sent");
        setName("");
        setPhone("");
        setMessage("");
        setErrors(NO_ERRORS);
        return;
      }
      setStatus("error");
      // The envelope's message is already Persian and never leaks internals.
      setFormError(!body.ok && body.error.message !== "" ? body.error.message : t("checkout.error.generic"));
    } catch {
      // Offline or a body that is not JSON: one sentence, and the form keeps what was typed.
      setStatus("error");
      setFormError(t("checkout.error.generic"));
    }
  }

  if (status === "sent") {
    return (
      <p className="t-body" role="status">
        {t("page.contact.form.sent")}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
    {status === "captcha" && challenge !== null ? (
      <PowChallenge
        challenge={challenge}
        onSolved={(sol) => {
          setStatus("submitting");
          void send(encodePow(sol));
        }}
      />
    ) : null}
    <form
      className="grid gap-4"
      noValidate
      aria-busy={status === "submitting" || status === "captcha" || undefined}
      onSubmit={(e) => {
        void submit(e);
      }}
    >
      <Field
        name="name"
        label="page.contact.form.name"
        value={name}
        onChange={setName}
        onBlur={() => {
          blur("name");
        }}
        {...errorProp(errors.name)}
        required
        autoComplete="name"
        maxLength={80}
      />
      {/* `digits="fa"` is Field's own Persian-display / Latin-storage fold; the
          value in state is already Latin, so nothing here folds it a second time. */}
      <Field
        name="phone"
        label="page.contact.form.phone"
        type="tel"
        inputMode="tel"
        digits="fa"
        value={phone}
        onChange={setPhone}
        onBlur={() => {
          blur("phone");
        }}
        {...errorProp(errors.phone)}
        required
        autoComplete="tel"
        maxLength={11}
      />
      <Textarea
        name="message"
        label="page.contact.form.message"
        value={message}
        onChange={setMessage}
        onBlur={() => {
          blur("message");
        }}
        {...errorProp(errors.message)}
        maxLength={2000}
        rows={5}
      />

      {/* The form-level failure is a live region above the button, so it is announced when it
          appears and read in order by anyone tabbing to the submit. */}
      {status === "error" && formError !== "" ? (
        <p className="t-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        loading={status === "submitting"}
        disabled={status === "submitting"}
        className="justify-self-start"
      >
        {t("page.contact.form.send")}
      </Button>
    </form>
    </div>
  );
}
