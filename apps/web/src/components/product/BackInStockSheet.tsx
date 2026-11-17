"use client";
import { backInStockSchema, normalizePhone } from "@namilux/core/client";
import { useEffect, useState } from "react";
import { PhoneOtp } from "@/components/auth/PhoneOtp";
import { useUser } from "@/components/state/providers";
import { Bdi } from "@/components/ui/Bdi";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { t } from "@/i18n";
import type { FaKey } from "@/i18n";

type Status = "idle" | "submitting" | "sent" | "error";

/** `exactOptionalPropertyTypes` is on: an absent error is an absent prop, not `error={undefined}`. */
const errorProp = (message: string | undefined): { error?: string } => (message === undefined ? {} : { error: message });

/**
 * The envelope of the spec - narrowed by hand because a parsed body is untrusted input.
 * DECISION: `created` is read as `unknown` and only the literal `false` means «قبلاً ثبت شده»:
 * core's `backInStock.request` returns `{ created: boolean }` (false when a waiting row for this
 * (product, phone) already exists), and an older or malformed body must not turn a successful
 * subscription into a scary sentence.
 */
type BackInStockResponse = { ok: true; data: { created?: unknown } } | { ok: false; error: { code: string; message: string } };

// DECISION: the phone rule is read off `backInStockSchema` itself (the schema the route parses), so
// the browser and the server can never disagree about what a valid number is - the shape
// content/ContactForm established. The sentence shown is the schema's own Persian message, except
// for an empty field, which reads «این فیلد لازم است» from fa.ts.
function phoneError(value: string): string | undefined {
  if (value.trim() === "") return t("form.required");
  const result = backInStockSchema.shape.phone.safeParse(value);
  if (result.success) return undefined;
  return result.error.issues[0]?.message ?? t("form.required");
}

export function BackInStockSheet({
  open,
  onClose,
  productId,
  name,
}: {
  open: boolean;
  // Spelled as a property, not the header's method shorthand: identical type, and a method-shorthand
  // prop trips `@typescript-eslint/unbound-method` when destructured (same call as ui/Sheet).
  onClose: () => void;
  productId: number;
  name: string;
}): React.ReactNode {
  // DECISION: the spec wants the number prefilled when the shopper is logged in. There is no
  // client session store in the app and GET /api/me is unbuilt at the time (M3), so the field starts empty
  // rather than firing a speculative request from a sheet that may never be submitted.
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<Status>("idle");
  const [formError, setFormError] = useState("");
  const [sentKey, setSentKey] = useState<FaKey>("product.notify.done");
  const user = useUser();
  const [verified, setVerified] = useState(false);

  // Reopening the sheet is a new request: the previous confirmation or failure must not be the
  // first thing the next visit shows.
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setFormError("");
    setError(undefined);
  }, [open]);

  async function send(target: string): Promise<void> {
    setStatus("submitting");
    setFormError("");
    try {
      // DECISION: the body carries only `phone`. A guest verifies the number through PhoneOtp first
      // (purpose back_in_stock): /api/auth/otp/verify sets the session cookie the route reads, so the
      // strict `backInStockSchema` needs nothing else and the product id travels in the path.
      const res = await fetch(`/api/products/${String(productId)}/back-in-stock/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: target }),
      });
      const body = (await res.json()) as BackInStockResponse;
      if (res.ok && body.ok) {
        setSentKey(body.data.created === false ? "product.notify.exists" : "product.notify.done");
        setStatus("sent");
        setError(undefined);
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

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (status === "submitting") return;

    const next = phoneError(phone);
    setError(next);
    if (next !== undefined) {
      setStatus("idle");
      setFormError("");
      return;
    }
    // The stored form is Latin (Field folds it); normalizing here means the number leaves the
    // browser in the one storage shape the spec §persian defines.
    await send(normalizePhone(phone) ?? phone);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("product.notify.title")}>
      <div className="grid gap-5">
        <div className="grid gap-1">
          <p className="t-body font-semibold">
            <Bdi text={name} />
          </p>
          <p className="t-body text-ink-2">{t("product.notify.body")}</p>
        </div>

        {status === "sent" ? (
          <p className="t-body" role="status">
            {t(sentKey)}
          </p>
        ) : user === null && !verified ? (
          <div className="grid gap-3">
            <p className="t-sm text-ink-2">{t("product.request.verify")}</p>
            <PhoneOtp
              purpose="back_in_stock"
              compact
              onVerified={(r) => {
                // The session cookie is set by /api/auth/otp/verify; the subscription follows at once.
                setVerified(true);
                setPhone(r.phone);
                void send(r.phone);
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
                // Validate on blur, never on every keystroke.
                setError(phoneError(phone));
              }}
              {...errorProp(error)}
              required
              autoComplete="tel"
              maxLength={11}
            />

            {/* The form-level failure is a live region above the button, so it is announced when it
                appears and read in order by anyone tabbing to the submit. */}
            {status === "error" && formError !== "" ? (
              <p className="t-sm text-danger" role="alert">
                {formError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" block loading={status === "submitting"} disabled={status === "submitting"}>
              {t("product.notify")}
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
