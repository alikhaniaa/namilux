import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fa } from "../fa";

const SRC = resolve(import.meta.dirname, "../..");
const entries = Object.entries(fa) as [string, string][];
const keys = entries.map(([key]) => key);

/** Everything under src/ that could name a key - fa.ts itself and the tests excluded. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !path.endsWith(join("i18n", "fa.ts"))) out.push(path);
  }
  return out;
}
const corpus = sources(SRC)
  .filter((path) => !path.includes("__tests__"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const names = (key: string): boolean =>
  corpus.includes(`"${key}"`) || corpus.includes(`'${key}'`) || corpus.includes("`" + key + "`");

/**
 * Keys whose screen has not been built yet. Every entry belongs to a component or route that is
 * not yet built when this was written - checkout, the account area, order/track/club, the cart page, the review and
 * question forms, the newsletter route - or to a copy gap recorded in the spec.
 *
 * DECISION: the spec header asks for "every key is referenced by a component (grep)", which cannot
 * be true while half the storefront is scaffolded. Freezing the current set turns the rule into
 * something enforceable today: the list may only SHRINK. A key added to fa.ts for a screen nobody
 * writes, or a key orphaned by deleting its last call site, fails immediately.
 */
const PENDING_SCREENS: readonly string[] = [
  "nav.about",
  "section.more",
  "product.colorMore",
  "product.dims.h",
  "product.dims.w",
  "product.dims.d",
  "product.dims.weight",
  "compare.rail",
  "cart.priceChanged",
  "checkout.stepOf",
  // checkout.otp.*, checkout.name.*, checkout.email and most checkout.address.* left this list at
  // M2: the shared OTP UI (auth/*) and the account address/profile forms now reference them.
  // M3 landed the cart page, the three-step checkout island and the result screen, so their
  // cart.*, checkout.* and result.* keys are now referenced and have left this list as well.
  // `checkout.address.postcode.err` left this list with the pay button's own address validation
  // (components/checkout/pay-sequence.ts), which names the postcode rule before the round trip.
  "checkout.address.addressHint",
  "checkout.gift",
  "checkout.gift.message",
  // account.* left this list at M2 (the account area - nav, login, orders list, addresses, profile,
  // wishlist, club and requests tabs - now references every one of its keys).
  "order.detail",
  "club.title",
  "page.contact.title",
  "toast.offline",
  "pwa.coach.inapp.title",
  "pwa.coach.inapp.body",
  "pwa.coach.bip.title",
  "pwa.coach.ios.title",
  "pwa.coach.ios.body",
  "form.email.invalid",
  "form.tooLong",
];

describe("fa strings", () => {
  it("uses Persian punctuation without long dashes", () => {
    expect(entries.filter(([, value]) => /[ - –]|\s،/.test(value))).toEqual([]);
  });
  it("has the whole storefront vocabulary", () => {
    expect(keys.length).toBeGreaterThan(300);
  });

  it("no Latin digits in any value", () => {
    // §11.2: Persian digits in all UI text.
    expect(entries.filter(([, v]) => /[0-9]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("no exclamation marks", () => {
    // §11.6, and v2 §10.2's voice: the storefront never shouts.
    expect(entries.filter(([, v]) => /[!！]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("no straight double quotes - quotation is «…»", () => {
    // §11.6. The straight pair and the curly English pair are both wrong for Persian copy.
    expect(entries.filter(([, v]) => /["“”‘’]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("guillemets are balanced", () => {
    const bad = entries.filter(([, v]) => (v.match(/«/g) ?? []).length !== (v.match(/»/g) ?? []).length);
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("uses the Persian thousands separator, never a comma, inside a number", () => {
    // §11.6 (U+066C). A Latin comma between Persian digits passes the digit rule and still ships
    // the wrong separator, so it needs its own assertion.
    expect(entries.filter(([, v]) => /[۰-۹][,،][۰-۹]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("carries no Arabic ي/ك - the Persian letters only", () => {
    // §11.7 folds these on the way in; a hand-typed value can still smuggle one through, and it
    // renders in a different shape and never matches a normalized search.
    expect(entries.filter(([, v]) => /[يك]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it("every key is referenced by a component", () => {
    const orphans = keys.filter((key) => !names(key) && !PENDING_SCREENS.includes(key));
    expect(orphans).toEqual([]);
  });

  it("the pending-screen list only shrinks", () => {
    // The other half of the rule: once a screen lands, its keys leave the list. An entry that is
    // now referenced (or no longer exists) is stale and has to be deleted from PENDING_SCREENS.
    const stale = PENDING_SCREENS.filter((key) => names(key) || !keys.includes(key));
    expect(stale).toEqual([]);
  });
});
