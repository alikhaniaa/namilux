import { faZwnj } from "../persian/zwnj";
import { stripControl } from "../persian/normalize";

/**
 * The announcement-bar (promo_bar) rules, in one place.
 *
 * WHY THIS MODULE EXISTS: the write path (`content/banners.ts` `copyField` + `upsertBanner`) is the
 * authority for this copy, but the admin editor has to explain a rejection BEFORE the request is
 * sent - otherwise the owner gets the handler's generic «اطلاعات ارسال‌شده معتبر نیست.» and has no
 * idea which field broke which rule. The rule is therefore stated once here, pure and free of any
 * database import, and the admin panel imports it through `@namilux/core/client`.
 *
 * The mirror is not trusted blindly: `content/__tests__/promo.test.ts` feeds a table of titles
 * through this module AND through `upsertBanner` and fails if the two ever disagree.
 */

export const PROMO_BAR_SLOT = "promo_bar";
/** `banners.ts` PROMO_TITLE_MAX: the storefront's one-line bar takes 70 characters, never 80. */
export const PROMO_BAR_TITLE_MAX = 70;
/** `banners.ts` CTA_LABEL_MAX. */
export const PROMO_BAR_CTA_LABEL_MAX = 40;
/** `validation/common.zHref` HREF_MAX. */
export const PROMO_BAR_HREF_MAX = 512;
/** `app/api/promo` messages max - the editor's add button stops here. */
export const PROMO_BAR_MESSAGES_MAX = 20;
/** `settings/schema.promo.bar` rotateSec bounds. */
export const PROMO_BAR_ROTATE_SEC_MIN = 4;
export const PROMO_BAR_ROTATE_SEC_MAX = 30;

export type PromoCopyFault = "required" | "too_long" | "exclamation" | "latin_digit";
export type PromoHrefFault = "empty" | "too_long" | "unsafe";

/** the spec - no exclamation marks in UI copy (ASCII and full-width). */
const EXCLAMATION_RE = /[!！]/;
/** rules: promo-bar copy is Persian-digits-only. */
const LATIN_DIGIT_RE = /[0-9]/;
const WHITESPACE_RE = /\s/;
// eslint-disable-next-line no-control-regex -- mirrors menus.ts CONTROL_CHARS_RE: a raw CR/LF in a stored href would split a Location header
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/;

/** The normalisation `content/banners.ts` copyField applies before it measures copy. */
export function promoCopyValue(raw: string): string {
  return faZwnj(stripControl(raw).trim());
}

/** `copyField`'s checks, as a value the UI can turn into a field message. */
export function promoCopyFault(raw: string, max: number): PromoCopyFault | null {
  const value = promoCopyValue(raw);
  if (value === "") return "required";
  if (value.length > max) return "too_long";
  if (EXCLAMATION_RE.test(value)) return "exclamation";
  return null;
}

/** `upsertBanner`'s promo-bar title rule: the copy rules plus the Latin-digit ban. */
export function promoTitleFault(raw: string): PromoCopyFault | null {
  const fault = promoCopyFault(raw, PROMO_BAR_TITLE_MAX);
  if (fault !== null) return fault;
  // rules: the promo line is Persian copy - a Latin digit belongs to a model designator,
  // never to a rotating message.
  return LATIN_DIGIT_RE.test(promoCopyValue(raw)) ? "latin_digit" : null;
}

/**
 * The CTA href rule of `content/menus.ts` `isSafeHref` (re-checked by `zHref` before it): https or a
 * rooted path, no whitespace/backslash/`..`, no protocol-relative `//`. `content/__tests__/promo.test.ts`
 * pins this against the real predicate.
 */
export function promoHrefFault(raw: string): PromoHrefFault | null {
  const href = raw.trim();
  if (href === "") return "empty";
  if (href.length > PROMO_BAR_HREF_MAX) return "too_long";
  if (CONTROL_CHARS_RE.test(href) || WHITESPACE_RE.test(href) || href.includes("\\") || href.includes("..")) return "unsafe";
  if (href.startsWith("https://")) return href.length > "https://".length && href[8] !== "/" ? null : "unsafe";
  return href.startsWith("/") && !href.startsWith("//") ? null : "unsafe";
}

// ---------------------------------------------------------------- Persian explanations

/**
 * A rejection, stated as the owner reads it: what is wrong AND what to do about it. Keyed by the
 * `details.reason` that `upsertBanner` / `replacePromoBar` throw, so the server's error message and
 * the editor's field message are the same sentence.
 */
export function promoFaultFa(field: string, reason: string): string {
  const leaf = field.split(".").pop() ?? field;
  switch (`${leaf}:${reason}`) {
    case "title:required":
      return "متن پیام خالی است. یک جملهٔ کوتاه بنویسید یا این پیام را حذف کنید.";
    case "title:too_long":
      return `متن پیام حداکثر ${faCount(PROMO_BAR_TITLE_MAX)} نویسه است تا در یک خط جا شود. کوتاه‌ترش کنید.`;
    case "title:exclamation":
    case "ctaLabel:exclamation":
      return "علامت تعجب مجاز نیست. آن را حذف کنید.";
    case "title:latin_digit":
      return "عدد را با رقم فارسی بنویسید (مثلاً ۲۰ به‌جای 20).";
    case "ctaLabel:required":
      return "برای این لینک یک متن دکمه بنویسید (مثلاً «مشاهده»)، یا لینک را پاک کنید.";
    case "ctaLabel:too_long":
      return `متن دکمه حداکثر ${faCount(PROMO_BAR_CTA_LABEL_MAX)} نویسه است.`;
    case "ctaLabel:cta_pair_required":
    case "ctaHref:cta_pair_required":
      return "متن دکمه و لینک باید با هم پر شوند یا هر دو خالی بمانند.";
    case "ctaHref:required":
      return "برای این دکمه یک لینک بنویسید، یا متن دکمه را پاک کنید.";
    case "ctaHref:too_long":
      return `لینک حداکثر ${faCount(PROMO_BAR_HREF_MAX)} نویسه است.`;
    case "ctaHref:unsafe":
    case "ctaHref:unsafe_href":
      return "لینک باید با / (صفحه‌ای از همین فروشگاه، مثل ‎/c/oven‎) یا https:// شروع شود و فاصله نداشته باشد.";
    case "startsAt:invalid":
      return "تاریخ شروع خوانا نیست. دوباره از تقویم انتخاب کنید.";
    case "endsAt:invalid":
      return "تاریخ پایان خوانا نیست. دوباره از تقویم انتخاب کنید.";
    case "endsAt:required":
      return "تاریخ پایان لازم است؛ هر پیام نوار اعلان باید زمان پایان داشته باشد تا خودکار جمع شود.";
    case "endsAt:invalid_window":
      return "تاریخ پایان باید بعد از تاریخ شروع باشد.";
    case "id:not_in_slot":
      return "این پیام دیگر در نوار اعلان نیست (شاید در برگهٔ دیگری حذف شده). صفحه را تازه کنید.";
    case "id:duplicate":
      return "یک پیام دو بار در فهرست آمده است. صفحه را تازه کنید.";
    case "slot:slot_mismatch":
      return "این پیام متعلق به نوار اعلان نیست.";
    case "messages:too_many":
      return `حداکثر ${faCount(PROMO_BAR_MESSAGES_MAX)} پیام می‌توان داشت. پیام‌های قدیمی را حذف کنید.`;
    case "rotateSec:out_of_range":
      return `فاصلهٔ چرخش باید بین ${faCount(PROMO_BAR_ROTATE_SEC_MIN)} تا ${faCount(PROMO_BAR_ROTATE_SEC_MAX)} ثانیه باشد.`;
    default:
      return "این مقدار پذیرفته نشد. آن را بازبینی کنید.";
  }
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
/** Local digit mapper so this module stays free of anything but the two Persian helpers above. */
function faCount(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

// ---------------------------------------------------------------- the whole draft

export type PromoDraftMessage = {
  title: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

/** `messages.<i>.<field>` (or `settings.rotateSec` / `messages`) → Persian message. */
export type PromoDraftErrors = Record<string, string>;

/**
 * Every rule `replacePromoBar` enforces that can be judged without the database, applied to the
 * editor's draft so the owner sees each broken field before anything is sent.
 */
export function validatePromoDraft(messages: readonly PromoDraftMessage[], rotateSec: number): PromoDraftErrors {
  const errors: PromoDraftErrors = {};
  const put = (field: string, reason: string): void => {
    errors[field] ??= promoFaultFa(field, reason);
  };
  if (messages.length > PROMO_BAR_MESSAGES_MAX) put("messages", "too_many");
  if (!Number.isInteger(rotateSec) || rotateSec < PROMO_BAR_ROTATE_SEC_MIN || rotateSec > PROMO_BAR_ROTATE_SEC_MAX) {
    put("settings.rotateSec", "out_of_range");
  }
  messages.forEach((m, i) => {
    const at = (f: string): string => `messages.${String(i)}.${f}`;
    const title = promoTitleFault(m.title);
    if (title !== null) put(at("title"), title);

    const label = (m.ctaLabel ?? "").trim();
    const href = (m.ctaHref ?? "").trim();
    if (label !== "") {
      const fault = promoCopyFault(label, PROMO_BAR_CTA_LABEL_MAX);
      if (fault !== null) put(at("ctaLabel"), fault);
    }
    if (href !== "") {
      const fault = promoHrefFault(href);
      if (fault !== null) put(at("ctaHref"), fault);
    }
    if (label === "" && href !== "") put(at("ctaLabel"), "required");
    if (href === "" && label !== "") put(at("ctaHref"), "required");

    const start = m.startsAt === null ? null : Date.parse(m.startsAt);
    const end = m.endsAt === null ? null : Date.parse(m.endsAt);
    if (start !== null && Number.isNaN(start)) put(at("startsAt"), "invalid");
    if (end === null) put(at("endsAt"), "required");
    else if (Number.isNaN(end)) put(at("endsAt"), "invalid");
    else if (start !== null && !Number.isNaN(start) && end <= start) put(at("endsAt"), "invalid_window");
  });
  return errors;
}

export type PromoMessageState = "off" | "scheduled" | "live" | "expired";

/** What the storefront does with one message right now - the same half-open window as `isLive`. */
export function promoMessageState(m: { isActive: boolean; startsAt: string | null; endsAt: string | null }, at: Date): PromoMessageState {
  if (!m.isActive) return "off";
  const now = at.getTime();
  const start = m.startsAt === null ? null : Date.parse(m.startsAt);
  const end = m.endsAt === null ? null : Date.parse(m.endsAt);
  if (end !== null && !Number.isNaN(end) && now >= end) return "expired";
  if (start !== null && !Number.isNaN(start) && now < start) return "scheduled";
  return "live";
}
