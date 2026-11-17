"use client";
import { conciergeSchema, conciergeText, normalizePhone, whatsappUrl } from "@namilux/core/client";
import { useEffect, useState } from "react";
import { PhoneOtp } from "@/components/auth/PhoneOtp";
import { useUser } from "@/components/state/providers";
import { toast } from "@/components/state/toast-store";
import { Bdi } from "@/components/ui/Bdi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Textarea } from "@/components/ui/Textarea";
import { t } from "@/i18n";

type Status = "idle" | "submitting" | "sent" | "error";
type FieldName = "phone" | "note";
type Errors = Record<FieldName, string | undefined>;

const NO_ERRORS: Errors = { phone: undefined, note: undefined };

/** `exactOptionalPropertyTypes` is on: an absent error is an absent prop, not `error={undefined}`. */
const errorProp = (message: string | undefined): { error?: string } => (message === undefined ? {} : { error: message });

/** The envelope of the spec - narrowed by hand because a parsed body is untrusted input. */
type ConciergeResponse = { ok: true; data: { id: string } } | { ok: false; error: { code: string; message: string } };

// DECISION: the field rules are read off `conciergeSchema` itself (the schema the route parses),
// so the browser and the server can never disagree about what a valid number is - the same shape
// ContactForm established. The sentence shown is the schema's own Persian message, except for an
// empty required field, which reads «این فیلد لازم است» from fa.ts.
function fieldError(name: FieldName, value: string): string | undefined {
  // `note` is optional in the schema (zMultiline(500).optional()): blank is a valid request.
  if (value.trim() === "") return name === "note" ? undefined : t("form.required");
  const result = conciergeSchema.shape[name].safeParse(value);
  if (result.success) return undefined;
  return result.error.issues[0]?.message ?? t("form.required");
}

/**
 * DECISION: the sheet is handed a finished `whatsappHref` (the store's line) but the spec wants
 * the deep link to carry the prefilled sentence about *this* product. Rather than concatenate a
 * query string here - every URL must be built by core/url - the number is read back out
 * of the link, normalized, and the link is rebuilt by `whatsappUrl` + `conciergeText`. A link that
 * carries no readable Iranian mobile number is passed through untouched instead of being dropped.
 */
function prefilledWhatsapp(href: string, product: { displayName: string; sku: string | null; url: string }): string {
  const digits = /wa\.me\/(\d{6,15})/.exec(href)?.[1];
  const phone = digits === undefined ? null : normalizePhone(digits);
  if (phone === null) return href;
  return whatsappUrl(phone, conciergeText(product));
}

export function ConciergeSheet({
  open,
  onClose,
  product,
  whatsappHref,
  phoneHref,
  promise,
}: {
  open: boolean;
  // Spelled as a property, not the header's method shorthand: identical type, and a method-shorthand
  // prop trips `@typescript-eslint/unbound-method` when destructured (same call as ui/Sheet).
  onClose: () => void;
  product: { id: number; displayName: string; sku: string | null; url: string };
  whatsappHref: string;
  phoneHref: string;
  promise: string;
}): React.ReactNode {
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState("");
  const user = useUser();
  const [verified, setVerified] = useState(false);

  // Reopening the sheet is a new conversation: the previous confirmation or failure must not be the
  // first thing the next visit shows. Only the outcome resets - a number already typed is kept.
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setFormError("");
    setErrors(NO_ERRORS);
  }, [open]);

  const values: Record<FieldName, string> = { phone, note };
  const blur = (f: FieldName): void => {
    // Validate on blur, never on every keystroke.
    setErrors((prev) => ({ ...prev, [f]: fieldError(f, values[f]) }));
  };

  const sku = product.sku === null || product.sku.trim() === "" ? null : product.sku;
  const waHref = whatsappHref === "" ? "" : prefilledWhatsapp(whatsappHref, product);

  const copyCode = (): void => {
    if (sku === null) return;
    void navigator.clipboard.writeText(sku).then(
      () => {
        toast.show({ key: "product.codeCopied" });
      },
      () => {
        // Clipboard denied (an insecure context or a permission): nothing to announce.
      },
    );
  };

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status === "submitting") return;

    const next: Errors = { phone: fieldError("phone", phone), note: fieldError("note", note) };
    setErrors(next);
    if (next.phone !== undefined || next.note !== undefined) {
      setStatus("idle");
      setFormError("");
      return;
    }

    setStatus("submitting");
    setFormError("");
    try {
      // DECISION: the body carries no `code` and no PoW token: a guest verifies the number through
      // PhoneOtp first (purpose verify_phone), which sets the session cookie the route reads; a logged-in
      // customer posts directly. `conciergeSchema` is strict, so only the keys it names are sent, and
      // whatever the route answers is a Persian sentence the shopper reads.
      const res = await fetch("/api/concierge/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The stored form is Latin (Field folds it); normalizing here means the number leaves the
        // browser in the one storage shape the spec §persian defines.
        body: JSON.stringify({
          productId: product.id,
          phone: normalizePhone(phone) ?? phone,
          ...(note.trim() === "" ? {} : { note }),
        }),
      });
      const body = (await res.json()) as ConciergeResponse;
      if (res.ok && body.ok) {
        setStatus("sent");
        setNote("");
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

  return (
    <Sheet open={open} onClose={onClose} title={t("product.concierge")}>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <p className="t-body font-semibold">
            <Bdi text={product.displayName} />
          </p>
          {sku === null ? null : (
            <p className="label text-ink-3">
              <Bdi text={sku} />
            </p>
          )}
          {/* The promise is settings copy, so it arrives as a prop; an empty setting
              shows nothing rather than an invented sentence. */}
          {promise.trim() === "" ? null : <p className="t-body text-ink-2">{promise}</p>}
        </div>

        <div className="grid gap-2">
          {waHref === "" ? null : (
            <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn btn--secondary btn--block">
              <Icon name="whatsapp" size={20} />
              {t("product.whatsapp")}
            </a>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {phoneHref === "" ? null : (
              <a href={phoneHref} className="btn btn--quiet">
                <Icon name="phone" size={20} />
                {t("product.call")}
              </a>
            )}
            {sku === null ? null : (
              <Button variant="quiet" onClick={copyCode}>
                {t("product.copyCode")}
              </Button>
            )}
          </div>
        </div>

        <div className="hairline-t pt-5">
          {status === "sent" ? (
            <p className="t-body" role="status">
              {t("product.onRequest.done")}
            </p>
          ) : user === null && !verified ? (
            <div className="grid gap-3">
              <p className="t-sm text-ink-2">{t("product.request.verify")}</p>
              <PhoneOtp
                purpose="verify_phone"
                compact
                onVerified={(r) => {
                  // The session cookie is set by /api/auth/otp/verify; the form opens with the number filled in.
                  setVerified(true);
                  setPhone(r.phone);
                }}
              />
            </div>
          ) : (
            <form
              className="grid gap-4"
              noValidate
              aria-busy={status === "submitting" || undefined}
              onSubmit={(e) => {
                void submit(e);
              }}
            >
              {/* `digits="fa"` is Field's own Persian-display / Latin-storage fold;
                  the value in state is already Latin, so nothing here folds it a second time. */}
              <Field
                name="phone"
                label="checkout.phone"
                type="tel"
                inputMode="tel"
                digits="fa"
                hint="checkout.phone.hint"
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
                name="note"
                label="product.onRequest.note"
                value={note}
                onChange={setNote}
                onBlur={() => {
                  blur("note");
                }}
                {...errorProp(errors.note)}
                maxLength={500}
                rows={3}
              />

              {/* The form-level failure is a live region above the button, so it is announced when
                  it appears and read in order by anyone tabbing to the submit. */}
              {status === "error" && formError !== "" ? (
                <p className="t-sm text-danger" role="alert">
                  {formError}
                </p>
              ) : null}

              <Button type="submit" variant="primary" block loading={status === "submitting"} disabled={status === "submitting"}>
                {t("product.onRequest")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </Sheet>
  );
}
