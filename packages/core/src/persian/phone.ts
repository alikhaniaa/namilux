import { enDigits, faDigits } from "./format";

export const IRAN_MOBILE_RE = /^09[0-39]\d{8}$/;
export const POSTCODE_RE = /^\d{10}$/;

// ---------------------------------------------------------------- internals
/** Whitespace, "-", "(", ")", "." - what humans and pasted contacts put inside a number. */
const SEPARATOR_RE = /[\s().-]/g;
const DIGITS_ONLY_RE = /^\d+$/;
const ELEVEN_DIGITS_RE = /^\d{11}$/;
const POSTCODE_SEPARATOR_RE = /[\s-]/g;
const MASKED = "***";
/** Shortest dialable Iranian national number (area code + subscriber); below it, it is a typo. */
const MIN_NATIONAL_DIGITS = 7;

// ---------------------------------------------------------------- contract
export function normalizePhone(input: string): string | null {
  if (typeof input !== "string" || input === "") return null;
  let v = enDigits(input).replace(SEPARATOR_RE, "");
  if (v.startsWith("+")) v = v.slice(1);
  if (!DIGITS_ONLY_RE.test(v)) return null;
  if (v.length === 14 && v.startsWith("0098")) v = "0" + v.slice(4);
  else if (v.length === 12 && v.startsWith("98")) v = "0" + v.slice(2);
  else if (v.length === 10 && v.startsWith("9")) v = "0" + v;
  return IRAN_MOBILE_RE.test(v) ? v : null;
}

export function isIranMobile(s: string): boolean {
  return normalizePhone(s) !== null;
}

export function maskPhone(phone: string): string {
  const p = enDigits(typeof phone === "string" ? phone : "");
  if (!ELEVEN_DIGITS_RE.test(p)) return MASKED;
  return p.slice(0, 4) + MASKED + p.slice(7);
}

export function phoneToE164(phone: string): string {
  if (typeof phone !== "string" || !IRAN_MOBILE_RE.test(phone)) {
    throw new RangeError("phoneToE164: expects a normalized 09XXXXXXXXX number");
  }
  return "+98" + phone.slice(1);
}

/**
 * E.164 for ANY Iranian number the shop publishes - the mobile line and the landline alike - 
 * or `null` when the input is not one.
 *
 * WHY: `phoneToE164` accepts a normalized `09XXXXXXXXX` mobile by contract and throws on anything
 * else, so «۰۲۱۵۵۵۵۰۰۰۰» - the shop's own landline, straight out of `store.contact.phoneLand` - 
 * had no URL builder at all and the contact page had to print it as inert text (the DECISION at
 * `content/ContactPage.PhoneLine` reported exactly this gap). A national number is a national
 * number; the only real difference is that a landline carries an area code instead of the mobile
 * `09` prefix.
 *
 * `null` rather than a throw: every caller is a render path and `store.contact.*` is free text an
 * owner types into the admin. Persian digits and the usual human separators are accepted;
 * `0098`/`+98`/`98` prefixes are folded, the trunk `0` is dropped, and the result is `+98…`.
 *
 * EDGE CASES: "" → null · "sales@…" → null (non-digits) · a number too short to dial (fewer than
 * 7 national digits, i.e. shorter than any real Iranian subscriber number) → null, so a
 * half-filled settings field never renders a tappable link that dials nothing.
 */
export function iranPhoneToE164(input: string): string | null {
  if (typeof input !== "string") return null;
  const raw = enDigits(input).replace(SEPARATOR_RE, "").replace(/^\+/, "");
  if (raw === "" || !DIGITS_ONLY_RE.test(raw)) return null;
  let national = raw;
  if (national.startsWith("0098")) national = national.slice(4);
  else if (national.startsWith("98") && national.length > 10) national = national.slice(2);
  national = national.replace(/^0+/, "");
  return national.length < MIN_NATIONAL_DIGITS ? null : `+98${national}`;
}

export function phoneDisplay(phone: string): string {
  const p = enDigits(typeof phone === "string" ? phone : "");
  // DECISION: display is never load-bearing - an unexpected shape is shown as-is in Persian
  // digits rather than throwing inside a render path.
  if (!ELEVEN_DIGITS_RE.test(p)) return faDigits(p);
  return faDigits(p.slice(0, 4) + " " + p.slice(4, 7) + " " + p.slice(7));
}

export function isPostcode(s: string): boolean {
  return normalizePostcode(s) !== null;
}

export function normalizePostcode(s: string): string | null {
  if (typeof s !== "string") return null;
  const v = enDigits(s).replace(POSTCODE_SEPARATOR_RE, "");
  return POSTCODE_RE.test(v) ? v : null;
}
