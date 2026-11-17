import { describe, expect, it, vi } from "vitest";
import type { Address, AddressInput, Quote } from "@namilux/core/client";
import {
  EMPTY_DRAFT,
  draftKey,
  errorKeyFor,
  isPristine,
  postJson,
  runPayment,
  safeServerMessage,
  validateDraft,
} from "../pay-sequence";
import type { AddressDraft, Envelope, PayDeps, PayInput, PlaceBody } from "../pay-sequence";

/**
 * The pay button's sequence: validate → save the address → re-quote FOR that address → place.
 *
 * Every case here is a way the old button lost an order or charged the wrong amount: it paid to the
 * address selected before the shopper typed a new one, it saved that address a second time on every
 * retry, and it placed with a signature made for a different province.
 */

const TEHRAN: AddressDraft = {
  label: "خانه",
  recipientFirstName: "علی",
  recipientLastName: "کریمی",
  recipientPhone: "۰۹۱۲۱۱۱۰۰۰۰",
  province: "THR",
  city: "تهران",
  address: "خیابان ولیعصر، کوچهٔ بهار، پلاک ۱۲",
  plaque: "۱۲",
  unit: "۳",
  postcode: "۱۲۳۴۵۶۷۸۹۰",
};

const SAVED: Address = {
  id: "0000000000000000000ADDR01",
  customerId: "0000000000000000000CUST01",
  label: "خانه",
  recipientName: "علی کریمی",
  recipientPhone: "09121110000",
  province: "THR",
  city: "تهران",
  address: "خیابان ولیعصر، کوچهٔ بهار، پلاک ۱۲",
  plaque: "12",
  unit: "3",
  postcode: "1234567890",
  isDefault: false,
  createdAt: "2026-09-20T09:00:00.000Z",
};

function quoteOf(over: Partial<Quote> = {}): Quote {
  return {
    channel: "main",
    lines: [{ productId: 7, name: "اجاق‌گاز", image: null, unitPrice: 1_000_000, qty: 1, lineTotal: 1_000_000, available: 4, status: "ok" }],
    subtotal: 1_000_000,
    discount: 0,
    pointsDiscount: 0,
    shipping: 0,
    grandTotal: 1_000_000,
    shippingKey: "free_nationwide",
    shippingOptions: [{ key: "free_nationwide", name: "ارسال رایگان", cost: 0, etaMin: 3, etaMax: 5 }],
    warnings: [],
    sig: "a".repeat(64),
    expiresAt: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

type Calls = { saved: AddressInput[]; quoted: { addressId: string }[]; placed: PlaceBody[] };

function harness(over: {
  save?: Envelope<{ address: Address }>;
  quote?: Envelope<Quote>;
  place?: Envelope<{ payment: { redirectUrl: string } }>;
} = {}): { deps: PayDeps; calls: Calls } {
  const calls: Calls = { saved: [], quoted: [], placed: [] };
  const deps: PayDeps = {
    saveAddress: async (input) => {
      calls.saved.push(input);
      return over.save ?? { ok: true, data: { address: SAVED } };
    },
    fetchQuote: async (req) => {
      calls.quoted.push({ addressId: req.addressId });
      return over.quote ?? { ok: true, data: quoteOf() };
    },
    place: async (body) => {
      calls.placed.push(body);
      return over.place ?? { ok: true, data: { payment: { redirectUrl: "https://gw.test/pay/1" } } };
    },
  };
  return { deps, calls };
}

function input(over: Partial<PayInput> = {}): PayInput {
  return {
    draft: null,
    selectedId: null,
    savedDraft: null,
    quote: quoteOf(),
    confirmed: null,
    lines: [{ productId: 7, qty: 1 }],
    couponCode: "",
    usePoints: false,
    shippingKey: "free_nationwide",
    note: "",
    paymentMethod: "zarinpal",
    ...over,
  };
}

describe("the new-address draft", () => {
  it("an untouched form is not an address - the saved selection still wins", () => {
    expect(isPristine(EMPTY_DRAFT)).toBe(true);
    expect(isPristine({ ...EMPTY_DRAFT, city: "شیراز" })).toBe(false);
    // Only what the shopper types counts: label and province carry defaults nobody chose.
    expect(isPristine({ ...EMPTY_DRAFT, label: "محل کار", province: "FRS" })).toBe(true);
  });

  it("the key follows the TEXT, not the typing - normalized digits are the same address", () => {
    expect(draftKey(TEHRAN)).toBe(draftKey({ ...TEHRAN, recipientPhone: "09121110000", postcode: "1234567890" }));
    expect(draftKey(TEHRAN)).not.toBe(draftKey({ ...TEHRAN, city: "کرج" }));
  });

  it("validation names the field, in Persian, before any request is made", () => {
    const cases: [Partial<AddressDraft>, string][] = [
      [{ recipientFirstName: " " }, "recipientFirstName"],
      [{ recipientLastName: " " }, "recipientLastName"],
      [{ recipientPhone: "0912" }, "recipientPhone"],
      [{ city: "" }, "city"],
      [{ address: "کوتاه" }, "address"],
      [{ postcode: "12345" }, "postcode"],
    ];
    for (const [over, field] of cases) {
      const res = validateDraft({ ...TEHRAN, ...over });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.field).toBe(field);
        expect(res.messageKey).toMatch(/^checkout\.address\./);
      }
    }
  });

  it("a valid draft is normalized the way the server stores it", () => {
    const res = validateDraft(TEHRAN);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Persian digits in, ASCII out - the phone and the postcode are matched against /^09\d{9}$/
      // and /^\d{10}$/ server-side.
      expect(res.input.recipientName).toBe("علی کریمی");
      expect(res.input.recipientPhone).toBe("09121110000");
      expect(res.input.postcode).toBe("1234567890");
      expect(res.input.isDefault).toBe(false);
    }
  });

  it("empty optional fields are omitted, not sent as empty strings", () => {
    const res = validateDraft({ ...TEHRAN, plaque: "  ", unit: "" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect("plaque" in res.input).toBe(false);
      expect("unit" in res.input).toBe(false);
    }
  });
});

describe("runPayment - save, quote, place, in that order", () => {
  it("a typed address is saved, quoted for, and placed with - one click, no separate save", async () => {
    const { deps, calls } = harness();
    const res = await runPayment(input({ draft: TEHRAN, selectedId: null }), deps);

    expect(calls.saved).toHaveLength(1);
    expect(calls.quoted).toEqual([{ addressId: SAVED.id }]);
    expect(calls.placed).toHaveLength(1);
    // The signature placed with is the one just returned FOR THIS ADDRESS, never the one on screen.
    expect(calls.placed[0]).toMatchObject({ addressId: SAVED.id, quoteSig: "a".repeat(64), shippingKey: "free_nationwide" });
    expect(calls.placed[0]?.expectedGrandTotal).toBe(input().quote?.grandTotal);
    expect(res.outcome).toEqual({ kind: "redirect", url: "https://gw.test/pay/1" });
    expect(res.created).toEqual({ key: draftKey(TEHRAN), address: SAVED });
  });

  it("a draft that is open and typed in beats the address selected underneath it", async () => {
    const { deps, calls } = harness();
    await runPayment(input({ draft: TEHRAN, selectedId: "0000000000000000000OLD001" }), deps);
    expect(calls.placed[0]?.addressId).toBe(SAVED.id);
  });

  it("an untouched open form falls back to the selected address, and saves nothing", async () => {
    const { deps, calls } = harness();
    const res = await runPayment(input({ draft: EMPTY_DRAFT, selectedId: "0000000000000000000OLD001" }), deps);
    expect(calls.saved).toHaveLength(0);
    expect(calls.quoted).toEqual([{ addressId: "0000000000000000000OLD001" }]);
    expect(calls.placed[0]?.addressId).toBe("0000000000000000000OLD001");
    expect(res.outcome.kind).toBe("redirect");
  });

  it("an existing saved selection still just works", async () => {
    const { deps, calls } = harness();
    const res = await runPayment(input({ draft: null, selectedId: SAVED.id }), deps);
    expect(calls.saved).toHaveLength(0);
    expect(res.outcome.kind).toBe("redirect");
    expect(calls.placed[0]?.addressId).toBe(SAVED.id);
  });

  it("no address at all: the form is asked for, and nothing is quoted or placed", async () => {
    const { deps, calls } = harness();
    const res = await runPayment(input({ draft: null, selectedId: null }), deps);
    expect(res.outcome).toEqual({ kind: "address-invalid", field: null, messageKey: "checkout.address.required" });
    expect(calls.quoted).toHaveLength(0);
    expect(calls.placed).toHaveLength(0);
  });

  it("an invalid address stays a form: no save, no quote, no order", async () => {
    const { deps, calls } = harness();
    const res = await runPayment(input({ draft: { ...TEHRAN, postcode: "۱۲۳" } }), deps);
    expect(res.outcome).toMatchObject({ kind: "address-invalid", field: "postcode" });
    expect(calls).toEqual({ saved: [], quoted: [], placed: [] });
    expect(res.created).toBeUndefined();
  });

  it("a rejected save shows the server's own Persian sentence and places nothing", async () => {
    const { deps, calls } = harness({ save: { ok: false, code: "VALIDATION", message: "شهر با استان هم‌خوانی ندارد" } });
    const res = await runPayment(input({ draft: { ...TEHRAN, city: "شیراز" } }), deps);
    expect(res.outcome).toMatchObject({ kind: "error", message: "شهر با استان هم‌خوانی ندارد", messageKey: "checkout.error.address" });
    expect(calls.quoted).toHaveLength(0);
    expect(calls.placed).toHaveLength(0);
  });
});

describe("runPayment - retries do not multiply addresses or orders", () => {
  it("a second click on the same draft reuses the row the first one created", async () => {
    const { deps, calls } = harness({ place: { ok: false, code: "PAYMENT_FAILED" } });
    const first = await runPayment(input({ draft: TEHRAN }), deps);
    expect(first.outcome).toMatchObject({ kind: "error", messageKey: "checkout.error.gateway" });
    expect(first.created).toBeDefined();

    // The page adopted what came back; the retry carries it.
    const second = await runPayment(input({ draft: TEHRAN, savedDraft: { key: first.created?.key ?? "", id: SAVED.id } }), deps);
    expect(calls.saved).toHaveLength(1);
    expect(second.created).toBeUndefined();
    expect(calls.placed).toHaveLength(2);
    expect(calls.placed[1]?.addressId).toBe(SAVED.id);
  });

  it("but an EDITED draft is a different address, and is saved", async () => {
    const { deps, calls } = harness();
    const stale = { key: draftKey(TEHRAN), id: SAVED.id };
    await runPayment(input({ draft: { ...TEHRAN, city: "کرج" }, savedDraft: stale }), deps);
    expect(calls.saved).toHaveLength(1);
  });

  it("an address saved before a later failure is still reported, so the retry can reuse it", async () => {
    const { deps } = harness({ quote: { ok: false, code: "INTERNAL" } });
    const res = await runPayment(input({ draft: TEHRAN }), deps);
    expect(res.outcome).toMatchObject({ kind: "error", messageKey: "checkout.error.generic" });
    expect(res.created?.address.id).toBe(SAVED.id);
  });
});

describe("runPayment - the amount is never changed quietly", () => {
  it("a total that moved with the address is presented, not charged", async () => {
    const shown = quoteOf();
    const fresh = quoteOf({ shipping: 120_000, grandTotal: 1_120_000, shippingKey: "courier", sig: "b".repeat(64) });
    const { deps, calls } = harness({ quote: { ok: true, data: fresh } });

    const res = await runPayment(input({ draft: TEHRAN, quote: shown }), deps);
    expect(res.outcome).toEqual({ kind: "confirm", quote: fresh, previous: { grandTotal: 1_000_000, shipping: 0 } });
    expect(calls.placed).toHaveLength(0);
  });

  it("once accepted, the accepted amount is what is placed", async () => {
    const fresh = quoteOf({ shipping: 120_000, grandTotal: 1_120_000, shippingKey: "courier", sig: "b".repeat(64) });
    const { deps, calls } = harness({ quote: { ok: true, data: fresh } });
    const res = await runPayment(
      input({ draft: TEHRAN, savedDraft: { key: draftKey(TEHRAN), id: SAVED.id }, quote: quoteOf(), confirmed: { grandTotal: 1_120_000, shipping: 120_000 } }),
      deps,
    );
    expect(res.outcome.kind).toBe("redirect");
    expect(calls.placed[0]).toMatchObject({ quoteSig: "b".repeat(64), shippingKey: "courier" });
  });

  it("a total that moves AGAIN after the acceptance is asked about again", async () => {
    const fresh = quoteOf({ shipping: 200_000, grandTotal: 1_200_000 });
    const { deps, calls } = harness({ quote: { ok: true, data: fresh } });
    const res = await runPayment(input({ selectedId: SAVED.id, confirmed: { grandTotal: 1_120_000, shipping: 120_000 } }), deps);
    expect(res.outcome.kind).toBe("confirm");
    expect(calls.placed).toHaveLength(0);
  });

  it("a basket the fresh quote had to change is never placed behind the shopper's back", async () => {
    const reduced = quoteOf({ lines: [{ productId: 7, name: "اجاق‌گاز", image: null, unitPrice: 1_000_000, qty: 1, lineTotal: 1_000_000, available: 1, status: "qty_reduced" }] });
    const { deps, calls } = harness({ quote: { ok: true, data: reduced } });
    const res = await runPayment(input({ selectedId: SAVED.id }), deps);
    expect(res.outcome).toEqual({ kind: "error", messageKey: "checkout.error.priceChanged", requote: true });
    expect(calls.placed).toHaveLength(0);
  });
});

describe("failures the shopper can act on", () => {
  it("a session that ended asks for a login, not for a retry", async () => {
    const { deps } = harness({ place: { ok: false, code: "UNAUTHORIZED", message: "برای ادامه باید وارد حساب خود شوید." } });
    const res = await runPayment(input({ selectedId: SAVED.id }), deps);
    expect(res.outcome).toMatchObject({ kind: "error", messageKey: "checkout.error.signIn", requote: false });
  });

  it("each code gets its own sentence - the catch-all is only for the unknown", () => {
    expect(errorKeyFor("RATE_LIMITED")).toBe("checkout.error.tooMany");
    expect(errorKeyFor("NOT_FOUND")).toBe("checkout.error.addressMissing");
    expect(errorKeyFor("COUPON_INVALID")).toBe("checkout.error.coupon");
    expect(errorKeyFor("MAINTENANCE")).toBe("checkout.error.maintenance");
    expect(errorKeyFor("CHECKOUT_DISABLED")).toBe("checkout.disabled");
    expect(errorKeyFor("INTERNAL")).toBe("checkout.error.generic");
  });

  it("only a sentence written for a shopper is shown - never raw error text", () => {
    expect(safeServerMessage("کد تخفیف دیگر معتبر نیست")).toBe("کد تخفیف دیگر معتبر نیست");
    expect(safeServerMessage("connect ECONNREFUSED 127.0.0.1:5432")).toBeUndefined();
    expect(safeServerMessage("<h1>502 Bad Gateway</h1> خطا")).toBeUndefined();
    expect(safeServerMessage("خطا at handler(/opt/namilux/app.js:12)")).toBeUndefined();
    expect(safeServerMessage("خطا https://internal.namilux/trace")).toBeUndefined();
    expect(safeServerMessage("خ".repeat(201))).toBeUndefined();
    expect(safeServerMessage("")).toBeUndefined();
    expect(safeServerMessage(undefined)).toBeUndefined();
  });
});

describe("postJson", () => {
  it("reads the site envelope, and turns anything else into INTERNAL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { n: 1 } }), { status: 200 })));
    await expect(postJson<{ n: number }>("/api/x/", {})).resolves.toEqual({ ok: true, data: { n: 1 } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: "زیاد بود" } }), { status: 429 })));
    await expect(postJson("/api/x/", {})).resolves.toEqual({ ok: false, code: "RATE_LIMITED", message: "زیاد بود" });

    // An invented code is not trusted as one.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "TEAPOT" } }), { status: 418 })));
    await expect(postJson("/api/x/", {})).resolves.toEqual({ ok: false, code: "INTERNAL" });

    // A dropped connection reaches the page exactly like a 500 - as an outcome, not a throw.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(postJson("/api/x/", {})).resolves.toEqual({ ok: false, code: "INTERNAL" });
    vi.unstubAllGlobals();
  });
});
