import { ERROR_HTTP_STATUS, normalizePhone, normalizePostcode } from "@namilux/core/client";
import type { Address, AddressInput, ErrorCode, ProvinceCode, Quote } from "@namilux/core/client";
import type { FaKey } from "@/i18n";

/**
 * The one sequence behind the checkout's pay button: validate → save the address → re-quote for it
 * → place.
 *
 * It lives outside the component on purpose. Every rule the shopper's money depends on - which
 * address is used when a draft is open, whether a second click may create a second address row,
 * whether a changed total may be charged without being shown - is decided here, from values passed
 * in, so none of it can read a stale piece of React state and none of it needs a browser to be
 * tested. The component keeps the state and the pixels; this file keeps the order of operations.
 *
 * DECISION: the address is validated here with plain string rules rather than core's `addressSchema`.
 * That schema imports the 2,705-city dataset (geo/provinces) for its province↔city refinement, and
 * pulling it into the first-load bundle is exactly what `loadProvinces()` exists to avoid. The
 * server still runs the full schema plus `addresses.normalizeInput`, and its Persian sentence for a
 * city that is not in the province is surfaced verbatim - this side only catches the typos that do
 * not deserve a round trip.
 */

/** The new-address form's fields, as the shopper typed them (nothing normalized yet). */
export type AddressDraft = {
  label: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientPhone: string;
  province: ProvinceCode;
  city: string;
  address: string;
  plaque: string;
  unit: string;
  postcode: string;
};

export const EMPTY_DRAFT: AddressDraft = {
  label: "خانه",
  recipientFirstName: "",
  recipientLastName: "",
  recipientPhone: "",
  // DECISION: Tehran preselected, like account/AddressList - a native <select> has no empty state
  // that reads as a question, and the province is re-checked against the city server-side anyway.
  province: "THR",
  city: "",
  address: "",
  plaque: "",
  unit: "",
  postcode: "",
};

/** The fields the shopper must type. `label`/`province` carry defaults, so they cannot signal intent. */
const TYPED_FIELDS = ["recipientFirstName", "recipientLastName", "recipientPhone", "city", "address", "plaque", "unit", "postcode"] as const;

/**
 * An untouched form: opened and then left alone. It must NOT block a shopper who opened "new
 * address" and then picked a saved one instead - but anything typed into it does win over the
 * saved selection (see `runPayment`).
 */
export function isPristine(draft: AddressDraft): boolean {
  return TYPED_FIELDS.every((f) => draft[f].trim() === "");
}

/** Identity of a draft's CONTENT, so the same text is never saved twice (a retry after a failure). */
export function draftKey(draft: AddressDraft): string {
  return JSON.stringify([
    draft.label.trim(),
    draft.recipientFirstName.trim(),
    draft.recipientLastName.trim(),
    normalizePhone(draft.recipientPhone) ?? draft.recipientPhone.trim(),
    draft.province,
    draft.city.trim(),
    draft.address.trim(),
    draft.plaque.trim(),
    draft.unit.trim(),
    normalizePostcode(draft.postcode) ?? draft.postcode.trim(),
  ]);
}

export type DraftError = { field: keyof AddressDraft | null; messageKey: FaKey };
export type DraftValidation = { ok: true; input: AddressInput } | ({ ok: false } & DraftError);

/** Mirrors the server's rules for the fields a browser can check alone (validation/address.ts). */
export function validateDraft(draft: AddressDraft): DraftValidation {
  const first = draft.recipientFirstName.trim();
  const last = draft.recipientLastName.trim();
  if (first.length === 0 || first.length > 40) return { ok: false, field: "recipientFirstName", messageKey: "checkout.address.err.firstName" };
  if (last.length === 0 || last.length > 40) return { ok: false, field: "recipientLastName", messageKey: "checkout.address.err.lastName" };
  const name = `${first} ${last}`;
  if (name.length > 80) return { ok: false, field: "recipientLastName", messageKey: "checkout.address.err.recipient" };
  const phone = normalizePhone(draft.recipientPhone);
  if (phone === null) return { ok: false, field: "recipientPhone", messageKey: "checkout.address.err.recipientPhone" };
  const city = draft.city.trim();
  if (city.length < 2 || city.length > 80) return { ok: false, field: "city", messageKey: "checkout.address.err.city" };
  const address = draft.address.trim();
  if (address.length < 10 || address.length > 500) return { ok: false, field: "address", messageKey: "checkout.address.err.address" };
  const postcode = normalizePostcode(draft.postcode);
  if (postcode === null) return { ok: false, field: "postcode", messageKey: "checkout.address.postcode.err" };
  const label = draft.label.trim();
  const input: AddressInput = {
    label: label === "" ? "خانه" : label.slice(0, 40),
    recipientName: name,
    recipientPhone: phone,
    province: draft.province,
    city,
    address,
    ...(draft.plaque.trim() === "" ? {} : { plaque: draft.plaque.trim() }),
    ...(draft.unit.trim() === "" ? {} : { unit: draft.unit.trim() }),
    postcode,
    isDefault: false,
  };
  return { ok: true, input };
}

// ---------------------------------------------------------------- the API envelope
export type Envelope<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message?: string };

function asErrorCode(code: unknown): ErrorCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(ERROR_HTTP_STATUS, code) ? (code as ErrorCode) : "INTERNAL";
}

const PERSIAN_RE = /[؀-ۿ]/;

/**
 * The server's own Persian sentence, or nothing.
 *
 * `fail()` only ever sends `AppError.fa` - copy written for the shopper - but a proxy, an offline
 * page or a future route could put anything in that field. A sentence is shown only if it looks
 * like one: Persian, short, and free of markup or links. Everything else falls back to our own key,
 * so no raw error text can ever reach the page.
 */
export function safeServerMessage(message: string | undefined): string | undefined {
  if (typeof message !== "string") return undefined;
  const m = message.trim();
  if (m === "" || m.length > 200) return undefined;
  if (!PERSIAN_RE.test(m)) return undefined;
  if (/[<>{}]|https?:|\bat \w+\(|\n/.test(m)) return undefined;
  return m;
}

/**
 * The sentence for a failure code. A `Record` rather than a switch: every code the API can answer
 * with is listed, so a code added to core cannot quietly fall into the catch-all.
 */
const ERROR_KEY: Record<ErrorCode, FaKey> = {
  UNAUTHORIZED: "checkout.error.signIn",
  VALIDATION: "checkout.error.address",
  NOT_FOUND: "checkout.error.addressMissing",
  RATE_LIMITED: "checkout.error.tooMany",
  PRICE_CHANGED: "checkout.error.priceChanged",
  OUT_OF_STOCK: "checkout.error.priceChanged",
  COUPON_INVALID: "checkout.error.coupon",
  PAYMENT_FAILED: "checkout.error.gateway",
  CHECKOUT_DISABLED: "checkout.disabled",
  MAINTENANCE: "checkout.error.maintenance",
  // Reached with a basket that cannot use instalments, where placeOrder sends its own sentence
  // naming the product; the key is the fallback if it ever does not.
  CONFLICT: "checkout.payment.notEligible",
  ON_REQUEST: "checkout.error.priceChanged",
  // Nothing on this page asks for a code or a captcha, and FORBIDDEN here is the origin gate - a
  // shopper can do nothing with any of them but try again.
  FORBIDDEN: "checkout.error.generic",
  OTP_INVALID: "checkout.error.generic",
  OTP_EXPIRED: "checkout.error.generic",
  OTP_LOCKED: "checkout.error.generic",
  CAPTCHA_REQUIRED: "checkout.error.generic",
  INTERNAL: "checkout.error.generic",
};

/** The static sentence for a failure code - never a catch-all when the code says something better. */
export function errorKeyFor(code: ErrorCode): FaKey {
  return ERROR_KEY[code] ?? "checkout.error.generic";
}

/** A quote must be re-fetched after these: the basket or its price is no longer what was shown. */
function requotes(code: ErrorCode): boolean {
  return code === "PRICE_CHANGED" || code === "OUT_OF_STOCK" || code === "CONFLICT" || code === "COUPON_INVALID";
}

// ---------------------------------------------------------------- the sequence
export type PayDeps = {
  saveAddress: (input: AddressInput) => Promise<Envelope<{ address: Address }>>;
  fetchQuote: (req: { lines: Line[]; couponCode: string; usePoints: boolean; shippingKey: string | null; addressId: string }) => Promise<Envelope<Quote>>;
  place: (body: PlaceBody) => Promise<Envelope<{ payment: { redirectUrl: string } }>>;
};

export type Line = { productId: number; qty: number };
export type Totals = { grandTotal: number; shipping: number };

export type PlaceBody = {
  quoteSig: string;
  expectedGrandTotal: number;
  lines: Line[];
  couponCode?: string;
  usePoints?: true;
  shippingKey: string;
  addressId: string;
  note?: string;
  paymentMethod: string;
};

export type PayInput = {
  /** The new-address form as it is on screen, or null when it is closed (a saved address is in use). */
  draft: AddressDraft | null;
  /** The saved address the book has selected. */
  selectedId: string | null;
  /** What a previous click in this same session already created out of `draft`, keyed by its text. */
  savedDraft: { key: string; id: string } | null;
  /** The quote the shopper is looking at - the amount the pay button names. */
  quote: Quote | null;
  /** Totals the shopper has just been shown and accepted; set only on the second pass. */
  confirmed: Totals | null;
  lines: Line[];
  couponCode: string;
  usePoints: boolean;
  shippingKey: string | null;
  note: string;
  paymentMethod: string;
};

export type PayOutcome =
  | { kind: "redirect"; url: string }
  | ({ kind: "address-invalid" } & DraftError)
  | { kind: "confirm"; quote: Quote; previous: Totals | null }
  | { kind: "error"; messageKey: FaKey; message?: string; requote: boolean };

/** `created` travels with EVERY outcome: an address saved before a later step failed still exists. */
export type PayResult = { outcome: PayOutcome; created?: { key: string; address: Address } };

function failure(res: { code: ErrorCode; message?: string }): PayOutcome {
  const message = safeServerMessage(res.message);
  return { kind: "error", messageKey: errorKeyFor(res.code), ...(message === undefined ? {} : { message }), requote: requotes(res.code) };
}

/**
 * One click on «پرداخت», start to finish. Never throws: every failure is an outcome the page can
 * render, with the shopper's typed values left untouched so the click can simply be repeated.
 */
export async function runPayment(input: PayInput, deps: PayDeps): Promise<PayResult> {
  let addressId = input.selectedId;
  let created: { key: string; address: Address } | undefined;

  // A draft with anything typed in it is what the shopper means to ship to - even if a saved
  // address is still selected underneath. Closing the form (picking a saved address) is how they
  // say otherwise, and the text stays in state for when they open it again.
  const draft = input.draft;
  if (draft !== null && !isPristine(draft)) {
    const key = draftKey(draft);
    if (input.savedDraft !== null && input.savedDraft.key === key) {
      // Second click on the same text (a gateway failure, a changed total): reuse the row the first
      // click created instead of filling the address book with copies.
      addressId = input.savedDraft.id;
    } else {
      const valid = validateDraft(draft);
      if (!valid.ok) return { outcome: { kind: "address-invalid", field: valid.field, messageKey: valid.messageKey } };
      const saved = await deps.saveAddress(valid.input);
      // A rejected address is a form to correct, not an order to place: nothing is quoted, nothing
      // is charged, and the fields stay exactly as they were typed.
      if (!saved.ok) return { outcome: failure(saved) };
      created = { key, address: saved.data.address };
      addressId = saved.data.address.id;
    }
  }

  if (addressId === null) {
    return { outcome: { kind: "address-invalid", field: null, messageKey: "checkout.address.required" }, ...(created === undefined ? {} : { created }) };
  }
  const withCreated = (outcome: PayOutcome): PayResult => ({ outcome, ...(created === undefined ? {} : { created }) });

  // The quote is fetched again FOR THIS ADDRESS. Province decides the shipping band and the ETA, so
  // the signed quote in hand was priced for whatever address was selected when it was made - not
  // necessarily the one about to be shipped to.
  const quoted = await deps.fetchQuote({
    lines: input.lines,
    couponCode: input.couponCode,
    usePoints: input.usePoints,
    shippingKey: input.shippingKey,
    addressId,
  });
  if (!quoted.ok) return withCreated(failure(quoted));
  const fresh = quoted.data;
  if (fresh.lines.some((l) => l.status === "removed" || l.status === "qty_reduced")) {
    return withCreated({ kind: "error", messageKey: "checkout.error.priceChanged", requote: true });
  }

  // Never charge an amount the shopper has not read. The baseline is what they have just accepted
  // if they accepted anything, otherwise what the button said.
  const baseline: Totals | null = input.confirmed ?? (input.quote === null ? null : { grandTotal: input.quote.grandTotal, shipping: input.quote.shipping });
  if (baseline === null || baseline.grandTotal !== fresh.grandTotal || baseline.shipping !== fresh.shipping) {
    return withCreated({ kind: "confirm", quote: fresh, previous: baseline });
  }

  const placed = await deps.place({
    quoteSig: fresh.sig,
    expectedGrandTotal: fresh.grandTotal,
    lines: input.lines,
    ...(input.couponCode === "" ? {} : { couponCode: input.couponCode }),
    ...(input.usePoints ? { usePoints: true as const } : {}),
    shippingKey: fresh.shippingKey ?? input.shippingKey ?? "free_nationwide",
    addressId,
    ...(input.note === "" ? {} : { note: input.note }),
    paymentMethod: input.paymentMethod,
  });
  if (!placed.ok) return withCreated(failure(placed));
  return withCreated({ kind: "redirect", url: placed.data.payment.redirectUrl });
}

/**
 * `fetch` reduced to the site's envelope. It never throws and never returns anything but the two
 * shapes above, so a dropped connection and a 500 reach the page the same way.
 */
export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json()) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
    if (parsed.ok === true && parsed.data !== undefined) return { ok: true, data: parsed.data };
    const code = asErrorCode(parsed.error?.code);
    const message = parsed.error?.message;
    return { ok: false, code, ...(typeof message === "string" ? { message } : {}) };
  } catch {
    return { ok: false, code: "INTERNAL" };
  }
}
