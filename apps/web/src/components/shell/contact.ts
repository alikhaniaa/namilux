import { enDigits, faDigits, iranTelUrl, phoneDisplay } from "@namilux/core/client";

/**
 * The shop's published numbers, ready to render.
 *
 * TWO rules live here, and only here, so every surface that prints a number obeys both:
 *
 *  1. ORDER - the landline «۰۲۱۵۵۵۵۰۰۰۰» comes FIRST, before the mobile (owner's instruction,
 *     20 Sep 2026): it is the number the shop actually answers during opening hours. Neither
 *     number is hard-coded: both are `store.contact.*`, and a field an owner leaves empty simply
 *     produces no line (never a dead `tel:`).
 *  2. GROUPING - `phoneDisplay` groups ELEVEN digits as a mobile (۰۹۱۲ ۱۲۳ ۰۰۷۷), which is the
 *     wrong shape for a landline of the same length: «۰۲۱۵ ۵۵۵ ۰۰۰۰» reads as nonsense. A
 *     national number that is not a mobile is grouped as area code + subscriber instead.
 *
 * `iranTelUrl` (core) is the only builder used for the href - it accepts the landline as well as
 * the mobile and answers `null` for anything too short to dial, so a half-filled setting can never
 * become a tappable link that dials nothing.
 */
export type ShopPhone = {
  /** `tel:+98…` */
  href: string;
  /** Persian digits, grouped for the kind of number it is. */
  display: string;
};

/** Iranian area codes are a trunk `0` and two digits (۰۲۱, ۰۳۱, ۰۵۱ …). */
const AREA_CODE_LEN = 3;
const SEPARATORS = /[\s().-]/g;

/** One number, or `null` when the setting is blank or is not a number anyone could dial. */
export function shopPhone(raw: string): ShopPhone | null {
  const href = iranTelUrl(raw);
  if (href === null) return null;
  const digits = enDigits(raw).replace(SEPARATORS, "").replace(/^\+98/, "0");
  if (/^09\d{9}$/.test(digits)) return { href, display: phoneDisplay(digits) };
  if (/^0\d{7,}$/.test(digits)) {
    return { href, display: faDigits(`${digits.slice(0, AREA_CODE_LEN)} ${digits.slice(AREA_CODE_LEN)}`) };
  }
  return { href, display: faDigits(digits) };
}

/** Both numbers the shop publishes, landline first, blanks dropped. */
export function shopPhones(contact: { phoneLand: string; phoneMobile: string }): ShopPhone[] {
  return [shopPhone(contact.phoneLand), shopPhone(contact.phoneMobile)].filter((p): p is ShopPhone => p !== null);
}
