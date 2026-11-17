"use client";
import { useEffect, useRef, useState } from "react";
import { INSTALMENT_INELIGIBLE, formatToman } from "@namilux/core/client";
import type { Address, Quote, QuoteAddressRef, SealEmbed } from "@namilux/core/client";
import { useCart } from "@/components/state/cart-store";
import { useQuote } from "@/components/cart/useQuote";
import { t } from "@/i18n";
import { AddressBook } from "./AddressBook";
import { CouponField } from "./CouponField";
import { PaymentMethods } from "./PaymentMethods";
import type { PaymentMethodKey, PaymentMethodOption } from "./PaymentMethods";
import { PointsToggle } from "./PointsToggle";
import { ShippingOptions } from "./ShippingOptions";
import { SummaryPanel } from "./SummaryPanel";
import { EMPTY_DRAFT, draftKey, errorKeyFor, postJson, runPayment, safeServerMessage, validateDraft } from "./pay-sequence";
import type { AddressDraft, DraftError, Envelope, PayDeps, Totals } from "./pay-sequence";

type Seal = SealEmbed | null;

/**
 * The two network calls the pay sequence makes on its own, plus the place call. They are adapters
 * only - every decision about them is in `pay-sequence.ts`, which is why they are passed in rather
 * than reached for.
 */
const deps: PayDeps = {
  saveAddress: (input) => postJson<{ address: Address }>("/api/me/addresses/", input),
  fetchQuote: (req) =>
    postJson<Quote>("/api/checkout/quote/", {
      lines: req.lines,
      ...(req.couponCode === "" ? {} : { couponCode: req.couponCode }),
      ...(req.usePoints ? { usePoints: true } : {}),
      ...(req.shippingKey === null ? {} : { shippingKey: req.shippingKey }),
      addressId: req.addressId,
    }),
  // The Idempotency-Key is the quote's signature: the same quote placed twice is the same order.
  place: (body) => postJson<{ payment: { redirectUrl: string } }>("/api/checkout/place/", body, { "Idempotency-Key": body.quoteSig }),
};

export function StepDelivery({ initialAddresses, snappEnabled, seals, pointsAvailable }: { initialAddresses: Address[]; snappEnabled: boolean; seals: { enamad: Seal; samandehi: Seal }; pointsAvailable: number }): React.ReactNode {
  const [addresses, setAddresses] = useState<Address[]>(initialAddresses);
  const [selectedId, setSelectedId] = useState<string | null>(initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null);
  const [adding, setAdding] = useState(initialAddresses.length === 0);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_DRAFT);
  const [addressError, setAddressError] = useState<DraftError | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [usePoints, setUsePoints] = useState(false);
  const [shippingKey, setShippingKey] = useState<string | null>(null);
  // The gateway is a fact about which storefront this is, not a choice: the server overrides
  // whatever is posted with the channel's own gateway. It is still held in state so the radio group
  // reads as a normal control.
  const [payment, setPayment] = useState<PaymentMethodKey>("zarinpal");
  // null until SnappPay has answered for this basket: unknown is not the same as refused, and the
  // two are shown differently - a pending probe only holds the button, a refusal explains itself.
  const [instalments, setInstalments] = useState<{ eligible: boolean; message?: string; description?: string; ineligibleProductIds?: number[] } | null>(null);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  // A total that moved under the shopper waits here until they accept it; nothing is charged while
  // this is open.
  const [confirm, setConfirm] = useState<{ quote: Quote; previous: Totals | null } | null>(null);
  // What the draft on screen has already been saved as, keyed by its text: a second click on an
  // unchanged draft reuses that row instead of adding another copy to the address book.
  const savedDraft = useRef<{ key: string; id: string } | null>(null);
  // A click that is already running, and a navigation that has started. Both are refs because a
  // second click can land before React has re-rendered with `placing` true.
  const running = useRef(false);
  const leaving = useRef(false);
  const { lines } = useCart();
  void pointsAvailable;

  // The quote follows the address that will actually be used: while the form is open that is the
  // draft, by province + city (the shipping band and the ETA are all the quote needs), so the
  // summary is right before the order is placed rather than after.
  const draftCity = draft.city.trim();
  const addressRef: QuoteAddressRef | null = adding
    ? (draftCity.length >= 2 ? { province: draft.province, city: draftCity } : null)
    : selectedId;

  const { quote, refresh } = useQuote({
    ...(couponCode !== "" ? { couponCode } : {}),
    usePoints,
    ...(shippingKey !== null ? { shippingKey } : {}),
    ...(addressRef !== null ? { addressRef } : {}),
  });

  const effectiveShipping = shippingKey ?? quote?.shippingKey ?? "free_nationwide";
  // Products the admin switched off for instalments. The instalment quote drops them as removed
  // lines with their own reason, and the eligibility endpoint names them again; either source is
  // enough to hold the button, and the server refuses the basket regardless (placeOrder).
  const ineligibleIds = new Set<number>([
    ...(quote?.warnings ?? []).flatMap((w) => (w.kind === "removed" && w.reason === INSTALMENT_INELIGIBLE ? [w.productId] : [])),
    ...(instalments?.ineligibleProductIds ?? []),
  ]);
  const ineligibleNames = (quote?.lines ?? []).filter((l) => ineligibleIds.has(l.productId) && l.name !== "").map((l) => l.name);
  const productsBlocked = payment === "snapppay" && ineligibleIds.size > 0;
  // A basket the instalment gateway refuses cannot be placed on this site at all - the server would
  // reject it, and the only other gateway lives on the other storefront. `pending` is the first
  // probe still in flight: the button waits, but nothing is claimed about the basket yet.
  const blocked = productsBlocked || (payment === "snapppay" && instalments !== null && !instalments.eligible);
  const pending = payment === "snapppay" && instalments === null && !productsBlocked;

  /** A saved address, wherever it came from: remember it, select it, and close the form over it. */
  const adopt = (created: { key: string; address: Address }): void => {
    savedDraft.current = { key: created.key, id: created.address.id };
    setAddresses((a) => (a.some((x) => x.id === created.address.id) ? a : [...a, created.address]));
    setSelectedId(created.address.id);
    setAdding(false);
    setAddressError(null);
  };

  /** The explicit «ذخیره در نشانی‌های من» button - the same save the pay button would have done. */
  const saveDraft = async (current: AddressDraft): Promise<void> => {
    if (running.current || leaving.current) return;
    running.current = true;
    setPlacing(true);
    try {
    const valid = validateDraft(current);
    if (!valid.ok) {
      setAddressError({ field: valid.field, messageKey: valid.messageKey });
      return;
    }
    setAddressError(null);
    const saved = await deps.saveAddress(valid.input);
    if (!saved.ok) {
      setError({ message: serverOrKey(saved), signIn: saved.code === "UNAUTHORIZED" });
      return;
    }
    adopt({ key: draftKey(current), address: saved.data.address });
    } finally {
      running.current = false;
      setPlacing(false);
    }
  };

  /**
   * One press of the pay button. `accepted` is set only on the second pass, when the shopper has
   * read a changed total and pressed «تأیید» - the sequence re-quotes either way, so what is
   * charged is always a quote the server has just signed for this address.
   */
  const pay = async (accepted: Totals | null): Promise<void> => {
    if (running.current || leaving.current || blocked || pending) return;
    running.current = true;
    setPlacing(true);
    setError(null);
    setAddressError(null);
    try {
      const result = await runPayment(
        {
          draft: adding ? draft : null,
          selectedId,
          savedDraft: savedDraft.current,
          quote,
          confirmed: accepted,
          lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          couponCode,
          usePoints,
          shippingKey: effectiveShipping,
          note,
          paymentMethod: payment,
        },
        deps,
      );
      // An address saved before a later step failed is a real row: adopt it whatever the outcome,
      // so the retry reuses it and the book shows it.
      if (result.created !== undefined) adopt(result.created);

      const outcome = result.outcome;
      if (outcome.kind === "redirect") {
        leaving.current = true;
        window.location.assign(outcome.url);
        return;
      }
      if (outcome.kind === "address-invalid") {
        setAdding(true);
        setAddressError({ field: outcome.field, messageKey: outcome.messageKey });
        return;
      }
      if (outcome.kind === "confirm") {
        setConfirm({ quote: outcome.quote, previous: outcome.previous });
        return;
      }
      setError({ message: outcome.message ?? t(outcome.messageKey), signIn: outcome.messageKey === "checkout.error.signIn" });
      if (outcome.requote) refresh();
    } catch {
      // runPayment does not throw; this is the last net, and it says nothing about what broke.
      setError({ message: t("checkout.error.generic"), signIn: false });
    } finally {
      // While the browser is leaving for the gateway the button stays disabled - a second press
      // during that navigation would be a second order.
      if (!leaving.current) {
        running.current = false;
        setPlacing(false);
      }
    }
  };

  // Instalments are not offered on every basket - SnappPay's credit floor and the shopper's
  // remaining limit both move, so the answer is per-basket and per-amount. On the main site nothing
  // is asked at all: there is no instalment gateway there to be eligible for.
  const grandTotal = quote?.grandTotal ?? 0;
  // Every product in the basket, removed or not - the endpoint re-checks the instalment switch on
  // all of them, so a product the quote already dropped is still named.
  const productIdsKey = lines.map((l) => l.id).join(",");
  useEffect(() => {
    setInstalments(null);
    if (!snappEnabled || grandTotal <= 0) return;
    let live = true;
    const productIds = productIdsKey === "" ? [] : productIdsKey.split(",").map(Number);
    void (async () => {
      try {
        const res = await fetch("/api/checkout/eligible/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: grandTotal, ...(productIds.length > 0 ? { productIds } : {}) }),
        });
        const body = (await res.json()) as { ok: boolean; data?: { eligible: boolean; message?: string; description?: string; ineligibleProductIds?: number[] } };
        if (live) setInstalments(body.ok && body.data !== undefined ? body.data : { eligible: false });
      } catch {
        if (live) setInstalments({ eligible: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [snappEnabled, grandTotal, productIdsKey]);

  // SnappPay's rule (academy «self-cms», FAQ «روش پرداخت اسنپ‌پی چگونه باید در سایت نمایش داده شود»):
  // offer the method ONLY when /eligible says true, with its title on the first line and its
  // description on the second, both exactly as returned - never our own wording, never greyed out.
  const snappTitle = instalments?.eligible === true ? instalments.message : undefined;
  const snappOffered = snappEnabled && snappTitle !== undefined && snappTitle !== "";
  const paymentMethods: PaymentMethodOption[] = [{ key: "zarinpal" }];
  if (snappOffered) paymentMethods.push({ key: "snapppay", title: snappTitle, note: instalments?.description ?? "" });

  // The basket changed and SnappPay no longer offers it: fall back to card instead of a dead choice.
  useEffect(() => {
    if (payment === "snapppay" && instalments !== null && !snappOffered) setPayment("zarinpal");
  }, [payment, instalments, snappOffered]);

  const payDisabled = placing || blocked || pending || confirm !== null || quote === null;

  return (
    <div className="checkout-grid">
      <fieldset disabled={placing || confirm !== null} className="m-0 flex min-w-0 flex-col gap-6 border-0 p-0">
        <AddressBook
          addresses={addresses}
          selectedId={selectedId}
          onSelect={setSelectedId}
          adding={adding}
          onAdding={(open) => {
            setAdding(open);
            setAddressError(null);
          }}
          draft={draft}
          onDraftChange={setDraft}
          onSave={saveDraft}
          error={addressError}
        />
        <ShippingOptions options={quote?.shippingOptions ?? []} value={effectiveShipping} onChange={setShippingKey} />
        <CouponField value={couponInput} onApply={(c) => { setCouponInput(c); setCouponCode(c); }} applied={quote?.coupon} onRemove={() => { setCouponCode(""); setCouponInput(""); }} />
        <PointsToggle points={quote?.points} checked={usePoints} onChange={setUsePoints} />
        <PaymentMethods methods={paymentMethods} value={payment} onChange={setPayment} />
        <label className="flex flex-col gap-1">
          <span className="t-caption text-ink-2">{t("checkout.note")}</span>
          <textarea className="line-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {snappEnabled && !snappOffered && ineligibleNames.length > 0 ? (
          // Our own rule, not SnappPay's answer: said as a plain note, never dressed as their option.
          <p className="t-caption text-ink-2">{t("checkout.payment.productsIneligibleNote", { names: ineligibleNames.join("، ") })}</p>
        ) : null}
        {error !== null ? (
          <p className="t-body text-danger" role="alert">
            {error.message}
            {error.signIn ? (
              <>
                {" "}
                <a className="link-under" href="/account/login/?next=/billing/">{t("checkout.error.signIn.cta")}</a>
              </>
            ) : null}
          </p>
        ) : null}
      </fieldset>
      <aside className="checkout-grid__aside flex flex-col gap-4">
        <SummaryPanel quote={quote} seals={seals} />
        {confirm !== null ? (
          <div className="panel ps-4 pe-4 pt-4 pb-4 flex flex-col gap-3" role="alert">
            <p className="t-body text-ink">{t("checkout.confirm.title")}</p>
            <p className="t-caption text-ink-2">
              {confirm.previous !== null
                ? t("checkout.confirm.changed", { shipping: formatToman(confirm.quote.shipping), total: formatToman(confirm.quote.grandTotal), previous: formatToman(confirm.previous.grandTotal) })
                : t("checkout.confirm.new", { shipping: formatToman(confirm.quote.shipping), total: formatToman(confirm.quote.grandTotal) })}
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={placing}
              onClick={() => {
                const accepted: Totals = { grandTotal: confirm.quote.grandTotal, shipping: confirm.quote.shipping };
                setConfirm(null);
                void pay(accepted);
              }}
            >
              {t("checkout.confirm.accept", { amount: formatToman(confirm.quote.grandTotal) })}
            </button>
            <button type="button" className="link-under t-caption self-start" onClick={() => setConfirm(null)}>{t("checkout.confirm.cancel")}</button>
          </div>
        ) : null}
        <button type="button" className="btn btn--primary btn--lg btn--block" onClick={() => void pay(null)} disabled={payDisabled}>
          {t("checkout.pay", { amount: quote !== null ? formatToman(quote.grandTotal) : "…" })}
        </button>
      </aside>
    </div>
  );
}

/** The server's sentence when it is safe to show, our own when it is not. */
function serverOrKey(res: Extract<Envelope<unknown>, { ok: false }>): string {
  return safeServerMessage(res.message) ?? t(errorKeyFor(res.code));
}
