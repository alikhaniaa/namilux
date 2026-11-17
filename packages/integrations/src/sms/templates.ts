import { AppError, faDigits } from "@namilux/core";
import type { SmsTemplate } from "@namilux/core/constants";
import { MAX_TEMPLATE_SEGMENTS, segmentsFor } from "./segments";

/**
 * The free-text fallback bodies · and the record of the wording registered as a FarazSMS pattern.
 *
 * These must stay word-for-word with the panel: a pattern send takes its text from FarazSMS, so any
 * drift here is a lie about what the customer received. The 7 Sep 2026 rebuild is why the wording
 * carries no per-order links: FarazSMS rejects a URL used as a *variable*, so every address is now a
 * fixed one printed literally · the account area ({site}/account, whose orders list carries the
 * retry-payment action) and the tracking form ({site}/track, which asks for the order code and
 * the phone number, exactly what these messages print).
 *
 * `{site}` is the bare host of the storefront the message is about, filled by the worker from the
 * order's (or the request's) channel: namilux.ir for the main site, the instalment domain for the
 * other. It is never a pattern variable, because FarazSMS refuses an address as a variable: the
 * instalment wording is registered as a pattern of its own, `<template>@instalments` in SMS_PATTERNS
 * (see `sitePatternKey`). The main site's rendered text is byte for byte what it was.
 */
export const DEFAULT_SMS_TEMPLATES: Record<SmsTemplate, string> = {
  otp: "کد ورود نامی‌لوکس: {code} · تا ۳ دقیقه معتبر است. این کد را به کسی ندهید.",
  "order.placed_pending": "سفارش شما در نامی‌لوکس ثبت شد. کد سفارش: {sefaresh} برای پرداخت، از بخش سفارش‌ها در {site}/account اقدام کنید.",
  "order.paid": "پرداخت سفارش {code} انجام شد. تحویل تا {eta} روز کاری. نامی‌لوکس",
  "order.shipped": "سفارش شما ارسال شد. کد سفارش: {code} شرکت حمل: {carrier} کد رهگیری: {tracking} پیگیری با کد سفارش در {site}/track · نامی‌لوکس",
  "order.delivered": "سفارش {code} تحویل داده شد. از خرید شما سپاسگزاریم · نامی‌لوکس",
  "order.expired": "مهلت پرداخت سفارش شما گذشت. کد سفارش: {sefaresh} برای پرداخت دوباره، از بخش سفارش‌ها در {site}/account اقدام کنید. نامی‌لوکس",
  "order.cancelled": "سفارش شما لغو شد. کد سفارش: {sefaresh} در صورت پرداخت، مبلغ بازگردانده می‌شود. وضعیت در {site}/track نامی‌لوکس",
  "product.back_in_stock": "طبق درخواست خودتان برای اطلاع از موجودی: کالای «{name}» دوباره موجود شد. نامی‌لوکس",
  // No {answer}: their reviewer caps a str variable at 25 characters, which turns a reply into a
  // stub. DIy15ksqcV names the product and sends the customer to the درخواست‌ها tab, which shows
  // the reply in full · a delivered pointer beats a truncated answer, and free text never arrives.
  "concierge.reply": "کارشناس نامی‌لوکس به پرسش شما دربارهٔ «{name}» پاسخ داد. متن پاسخ در بخش درخواست‌ها در {site}/account است.",
  "contact.reply": "پاسخ نامی‌لوکس به پیام شما: {answer}",
  "return.received": "درخواست بازگشت سفارش {code} ثبت شد؛ همکاران ما تماس می‌گیرند. نامی‌لوکس",
  "loyalty.tier_up": "به سطح {tier} باشگاه نامی‌لوکس خوش آمدید. مزایای شما: {benefits}",
  // Free text for good: FarazSMS reads a birthday gift as advertising and refuses to register it.
  "birthday.coupon": "زادروزتان مبارک! هدیهٔ نامی‌لوکس برای شما فعال است: {url}",
  "customer.welcome": "به نامی‌لوکس خوش آمدید. حساب کاربری و باشگاه مشتریان شما در {site}/account فعال است.",
  // Deliberately unregistered: bulk marketing is *meant* to be moderated.
  campaign: "{text} · لغو: {unsub}",
};

/** The one placeholder that is not a pattern variable: the storefront's bare host (see above). */
export const SITE_VAR = "site";

/** True when a template prints the storefront's address, so its wording differs between the two sites. */
export function namesSite(key: SmsTemplate): boolean {
  return (DEFAULT_SMS_TEMPLATES[key] ?? "").includes(`{${SITE_VAR}}`);
}

/**
 * The SMS_PATTERNS key a send uses. A message that prints an address is registered once per site,
 * because a pattern's wording lives in the FarazSMS panel: `order.shipped` says namilux.ir and
 * `order.shipped@instalments` says the instalment domain. A message that prints no address reads the
 * same on both sites and reuses the main pattern. When the instalment pattern is not registered, the
 * driver finds no code and sends the rendered text as free text: slower and moderated, but it never
 * names the main site.
 */
export function sitePatternKey(key: SmsTemplate, channel: "main" | "instalments"): SmsTemplate | `${SmsTemplate}@instalments` {
  return channel === "instalments" && namesSite(key) ? `${key}@instalments` : key;
}

/**
 * The variables each registered pattern actually declares · nothing else may be sent. A variable the
 * pattern does not have is rejected outright, which is why the rebuilt patterns dropped `url`
 * everywhere and `note` from order.cancelled.
 */
export const REQUIRED_VARS: Partial<Record<SmsTemplate, string[]>> = {
  otp: ["code"],
  // Not `code`: their reviewer reads that name as a one-time password and rewrites it to int(6),
  // which an NL-XXXXX order code does not fit. See PATTERN_VAR_LIMITS below.
  "order.placed_pending": ["sefaresh"],
  "order.paid": ["code", "eta"],
  "order.shipped": ["code", "carrier", "tracking"],
  "order.delivered": ["code"],
  "order.expired": ["sefaresh"],
  "order.cancelled": ["sefaresh"],
  "product.back_in_stock": ["name"],
  "concierge.reply": ["name"],
  "contact.reply": ["answer"],
  "return.received": ["code"],
  "loyalty.tier_up": ["tier", "benefits"],
  // 95DOACyydm declares no variables at all, and the pattern route still has to be used for it.
  "customer.welcome": [],
  // No pattern, free text only · so the link may stay.
  "birthday.coupon": ["url"],
  campaign: ["text", "unsub"],
};

/**
 * The length FarazSMS declares for each pattern variable (`GET /ws/v1/patterns/{code}`), read back
 * from the panel after approval on 7 Sep 2026. This matters more than it looks: a value LONGER than
 * the declared length is silently rerouted to human moderation while the API still answers
 * `success`, so one long answer turns an instant message into one that arrives whenever an operator
 * gets to it · or never. The driver truncates to these numbers rather than let that happen invisibly.
 *
 * **Read these back after approval, never from what was submitted.** Their reviewer rewrites the
 * declarations, and on 7 Sep 2026 the rule turned out to be the variable's NAME, not its length or
 * the category we file it under: every variable called `code` came back a 6-digit `int` · on the
 * originals, on the replacements submitted to fix them, and again on a third round filed under
 * category 3 (order), which the reviewer moved back to category 1 (otp) before narrowing it. To
 * them `code` *is* a one-time password. An order code is `NL-XXXXX`, 8 characters of letters and
 * digits, so the three order patterns that carry one now call the variable `sefaresh` («سفارش»,
 * order) · a name no reviewer can read as an OTP · and it was approved at `str` 10, untouched.
 * Anything else submitted longer than 25 still comes back at 25.
 *
 *   template               pattern code   declared after review
 *   otp                    6dd60ORlkc     code 6 int      (the OTP is exactly 6 digits · fits)
 *   order.placed_pending   BMLSGWOKp6     sefaresh 10 str
 *   order.paid             XkfO0I5gdR     code 10, eta 4  (approved before the rename; still intact)
 *   order.shipped          j7ZXDIMJt1     code 10, carrier 25, tracking 25
 *   order.delivered        MthrZpjp0d     code 10
 *   order.expired          n6fsTt537N     sefaresh 10 str
 *   order.cancelled        wEScZeJepK     sefaresh 10 str
 *   product.back_in_stock  lQEYf4nuBT     name 25         (submitted 60)
 *   concierge.reply        DIy15ksqcV     name 25         (no `answer` at all · see below)
 *   contact.reply          wQ9KkrCmAs     answer 25
 *   return.received        geHpA7Vkmn     code 10
 *   loyalty.tier_up        j3lpuRm1Ed     tier 20, benefits 25
 *   customer.welcome       95DOACyydm     no variables at all
 *
 * `code: 10` survives on the four order patterns approved before the rename (paid, shipped,
 * delivered, return.received) and is left alone: a working declaration is not worth resubmitting
 * into the same reviewer. The dead codes narrowed to `code 6 int` · OcDsNZjxao / a6GOqzleNH /
 * C3D2CLeQQT / 6GKf4Ub3Y8 (placed_pending), R5wv1dANFD / LqyqtVcYa8 / ft06b9vfKl (expired),
 * bcThq4hwxR / kgeJnKmT95 (cancelled) · are kept, unused, as the evidence for that rule.
 *
 * `concierge.reply` loses the other way: `answer` is the whole message and 25 characters is a stub,
 * so the pattern carries the product name only and sends the customer to namilux.ir/account, where
 * the full reply is already shown under درخواست‌ها. A delivered pointer beats a truncated answer,
 * and free text · the only route that could carry the whole answer · is the route that gets held for
 * a moderator and rejected. 25 is a hard ceiling, not a haggle: `tUkX5NMXP5` and `ERIqi7hXaQ` both
 * asked for `answer` at 200 and were REJECTED, told to open a support ticket instead. `contact.reply`
 * (wQ9KkrCmAs, answer 25) is stuck with a stub until someone does.
 */
export const PATTERN_VAR_LIMITS: Partial<Record<SmsTemplate, Readonly<Record<string, number>>>> = {
  otp: { code: 6 },
  "order.placed_pending": { sefaresh: 10 },
  "order.paid": { code: 10, eta: 4 },
  "order.shipped": { code: 10, carrier: 25, tracking: 25 },
  "order.delivered": { code: 10 },
  "order.expired": { sefaresh: 10 },
  "order.cancelled": { sefaresh: 10 },
  "product.back_in_stock": { name: 25 },
  "concierge.reply": { name: 25 },
  "contact.reply": { answer: 25 },
  "return.received": { code: 10 },
  "loyalty.tier_up": { tier: 20, benefits: 25 },
  "customer.welcome": {},
};

/** Their limit is a character count, and the ellipsis that marks the cut is one of those characters. */
export function truncateVar(value: string, limit: number): string {
  const chars = [...value];
  if (chars.length <= limit) return value;
  if (limit <= 1) return chars.slice(0, Math.max(limit, 0)).join("");
  return `${chars.slice(0, limit - 1).join("")}…`;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function warnTemplate(message: string): void {
  // eslint-disable-next-line no-console -- surfacing a bad template variable in dev; integrations has no logger
  if (process.env.NODE_ENV !== "production") console.warn(`[sms.template] ${message}`);
}

export function renderTemplate(
  key: SmsTemplate,
  vars: Record<string, string | number>,
  overrides?: Partial<Record<SmsTemplate, string>>,
): { text: string; segments: number } {
  // A template key with no body at all is a programming error, but it must not take the worker down
  // mid-send: fall back to the empty string, which segments to 0 and is dropped by the caller.
  const template = overrides?.[key] ?? DEFAULT_SMS_TEMPLATES[key] ?? "";
  if (template === "") warnTemplate(`no body registered for template ${key}`);
  const filled = template.replace(PLACEHOLDER, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      warnTemplate(`unknown variable {${name}} in template ${key}`);
      return "";
    }
    // numbers → Persian digits; strings (URLs, tracking codes) are kept verbatim (Latin)
    return typeof value === "number" ? faDigits(value) : String(value);
  });
  const text = filled.replace(/ {2,}/g, " ").trim();
  return { text, segments: segmentsFor(text) };
}

export function assertTemplate(text: string): void {
  if (segmentsFor(text) > MAX_TEMPLATE_SEGMENTS) {
    throw new AppError("VALIDATION", 400, "متن پیامک بیش از ۲ بخش است");
  }
}
