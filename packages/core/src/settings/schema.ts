import { z } from "zod";
import type { SmsTemplate } from "../constants";
import { appError } from "../errors";
import { TELEGRAM_EVENTS } from "../constants";
import { loyaltyRulesSchema, DEFAULT_LOYALTY_RULES } from "../loyalty/rules";
import { otpLimitsSchema, DEFAULT_OTP_LIMITS } from "../auth/quota";
import { DEFAULT_INSTALMENTS_RULE, instalmentsRule } from "../pricing/instalments";
import type { InstalmentsRule } from "../pricing/instalments";

export const SETTINGS_KEYS = [
  "store.info", "store.contact", "store.hours", "store.social", "seals.enamad_code", "seals.samandehi_code",
  // The instalment storefront is a different registered domain, so it carries its OWN trust seals;
  // the storefront picks the pair by channel. Empty = that site shows no seal.
  "seals.enamad_code_instalments", "seals.samandehi_code_instalments",
  "commerce.checkout_enabled", "commerce.maintenance", "commerce.max_per_order", "commerce.pending_ttl_min",
  "commerce.vat_percent", "commerce.installments", "shipping.copy", "loyalty.rules", "otp.limits", "sms.templates",
  "notify.telegram", "promo.bar", "seo.defaults", "pwa.coach", "analytics.sampling", "flags",
  // DECISION (M1): `system.contract` is written by `pnpm check:contract --record` and read by the
  // admin health panel - both named in `tests/contract/check-contract.ts`'s own contract - so the
  // row exists in every seeded database. Without it here, `getSettings` warned "unknown key" on
  // every cache miss, which is exactly the noise an operator learns to ignore. It is a report, not
  // an operator-editable setting: the schema is permissive and the admin surface renders it read-only.
  "system.contract",
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

const hours = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }).nullable();

// DECISION (M0 step 3): zod 4 `.default(v)` short-circuits parsing and therefore requires the full
// *output* value; the zod-3 "parse `{}` and let the inner .default()s fill it" behaviour is
// `.prefault(v)`. Every `.prefault({})` below is that (unchanged) intent - no default value changed.

export const settingsSchema = z.object({
  "store.info": z.object({ legalName: z.string().max(120).default("نامی لوکس"), brandName: z.string().max(60).default("نامی لوکس"), wordmark: z.string().max(60).default("نامی‌لوکس"), economicCode: z.string().max(40).default(""), registrationNo: z.string().max(40).default(""), vatId: z.string().max(40).default("") }).prefault({}),
  "store.contact": z.object({ phoneMobile: z.string().default("09121230077"), phoneLand: z.string().default(""), whatsapp: z.string().default("989121230077"), email: z.string().default(""), address: z.string().default("تهران، میدان شوش، خیابان صابونیان، پاساژ الماس بلورین، طبقهٔ دوم، پلاک ۶۴۲"), mapUrl: z.string().url().or(z.literal("")).default("") }).prefault({}),
  "store.hours": z.object({ days: z.object({ sat: hours, sun: hours, mon: hours, tue: hours, wed: hours, thu: hours, fri: hours }).default({ sat: { open: "09:00", close: "18:00" }, sun: { open: "09:00", close: "18:00" }, mon: { open: "09:00", close: "18:00" }, tue: { open: "09:00", close: "18:00" }, wed: { open: "09:00", close: "18:00" }, thu: { open: "09:00", close: "18:00" }, fri: { open: "09:00", close: "18:00" } }), note: z.string().max(80).default("همه‌روزه ۹ صبح تا ۶ عصر") }).prefault({}),
  "store.social": z.object({ instagram: z.string().default("namilux.ir"), telegram: z.string().default(""), aparat: z.string().default("") }).prefault({}),
  "seals.enamad_code": z.string().max(4000).default(""),
  "seals.samandehi_code": z.string().max(4000).default(""),
  "seals.enamad_code_instalments": z.string().max(4000).default(""),
  "seals.samandehi_code_instalments": z.string().max(4000).default(""),
  "commerce.checkout_enabled": z.boolean().default(true),
  "commerce.maintenance": z.object({ enabled: z.boolean().default(false), message: z.string().max(200).default("در حال به‌روزرسانی هستیم؛ تا دقایقی دیگر برمی‌گردیم.") }).prefault({}),
  "commerce.max_per_order": z.number().int().min(1).max(20).default(5),
  "commerce.pending_ttl_min": z.number().int().min(5).max(120).default(30),
  "commerce.vat_percent": z.number().min(0).max(25).default(0),
  // DECISION: `commissionPercent`/`roundTo` are the INSTALMENT SITE's price rule (what SnappPay
  // takes from us, and the step the grossed-up price is rounded up to). They join the existing
  // fields rather than replacing them: `feePercent`/`months`/`minAmount` describe the instalment
  // PLAN shown to the shopper and their consumers keep working untouched.
  "commerce.installments": z.object({ enabled: z.boolean().default(false), months: z.array(z.number().int().min(1).max(36)).default([3, 6, 12]), feePercent: z.number().min(0).max(60).default(0), minAmount: z.number().int().min(0).default(20_000_000), providerKey: z.string().nullable().default(null), commissionPercent: z.number().min(0).max(60).default(DEFAULT_INSTALMENTS_RULE.commissionPercent), roundTo: z.union([z.literal(1_000), z.literal(10_000), z.literal(100_000), z.literal(1_000_000)]).default(DEFAULT_INSTALMENTS_RULE.roundTo), markupPercent: z.number().min(0).max(100).nullable().default(null) }).prefault({}),
  "shipping.copy": z.object({ freeLine: z.string().max(80).default("ارسال رایگان به سراسر ایران"), etaNote: z.string().max(120).default("زمان ارسال بسته به استان ۱ تا ۷ روز کاری") }).prefault({}),
  // DECISION (M0): both carry an explicit default so rules "every key has a default" holds and
  // `DEFAULT_SETTINGS = settingsSchema.parse({})` (line below, and the header's "DEFAULT_SETTINGS
  // parses" test) does not throw. The values are the constants this module names.
  "loyalty.rules": loyaltyRulesSchema.default(DEFAULT_LOYALTY_RULES),
  "otp.limits": otpLimitsSchema.default(DEFAULT_OTP_LIMITS),
  "sms.templates": z.record(z.string(), z.string().max(320)).prefault({}) as unknown as z.ZodType<Record<SmsTemplate, string>>,
  // DECISION (M0 step 3): `z.enum(TELEGRAM_EVENTS)` replaces `z.array(z.string()) as unknown as …` - 
  // the cast erased the `.default([])` (so `.prefault({})` no longer typechecked) and let unknown
  // event names through. TELEGRAM_EVENTS is the dependency list source of this key.
  "notify.telegram": z.object({ chatId: z.string().default(""), events: z.array(z.enum(TELEGRAM_EVENTS)).default([]) }).prefault({}),
  "promo.bar": z.object({ enabled: z.boolean().default(true), rotateSec: z.number().int().min(4).max(30).default(8) }).prefault({}),
  "seo.defaults": z.object({ titleTemplate: z.string().max(80).default("%s - نامی لوکس"), defaultOgKey: z.string().default(""), siteName: z.string().max(60).default("نامی لوکس") }).prefault({}),
  "pwa.coach": z.object({ inappTitle: z.string().default("نسخهٔ اپ نامی‌لوکس"), inappBody: z.string().default("برای نصب نسخهٔ اپ، سایت را در مرورگر باز کنید"), bipTitle: z.string().default("نسخهٔ اپ نامی‌لوکس را به صفحهٔ اصلی اضافه کنید"), iosTitle: z.string().default("افزودن به صفحهٔ اصلی"), iosBody: z.string().default("در نوار پایین، دکمهٔ اشتراک‌گذاری را بزنید و «Add to Home Screen» را انتخاب کنید"), snoozeDays: z.number().int().min(1).max(90).default(14), maxShows: z.number().int().min(1).max(10).default(3) }).prefault({}),
  "analytics.sampling": z.object({ pageviews: z.number().min(0).max(1).default(1), events: z.number().min(0).max(1).default(1), retentionMonths: z.number().int().min(1).max(36).default(13) }).prefault({}),
  flags: z.object({ reviews: z.boolean().default(true), questions: z.boolean().default(true), wishlistServerSync: z.boolean().default(true), push: z.boolean().default(false), megaNav: z.boolean().default(false), densityToggle: z.boolean().default(false) }).prefault({}),
  // The last `check:contract --record` summary; `ok`/`total`/`covered`/`missing` are what the health
  // panel shows, the rest is passed through so the tool can extend its report without a migration.
  "system.contract": z
    .looseObject({
      ok: z.boolean().default(false),
      runAt: z.string().default(""),
      total: z.number().int().min(0).default(0),
      covered: z.number().int().min(0).default(0),
      missing: z.number().int().min(0).default(0),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;

/** The instalment price rule as it is stored - re-exported so a settings consumer needs no second import. */
export type { InstalmentsRule };
export { instalmentsRule, DEFAULT_INSTALMENTS_RULE };
export const settingsKeySchemas = settingsSchema.shape as unknown as { [K in SettingsKey]: z.ZodType<Settings[K]> };
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

export function parseSettingValue<K extends SettingsKey>(key: K, value: unknown): Settings[K] {
  // DECISION (M0 tests): the key is checked against SETTINGS_KEYS before it indexes the record, so a
  // prototype key ("__proto__", "constructor", "toString") can never resolve to Object.prototype and
  // be called as a schema (the spec: unknown input is rejected, never coerced).
  const known = (SETTINGS_KEYS as readonly string[]).includes(key);
  const schema = known ? (settingsKeySchemas as Record<string, z.ZodType<unknown>>)[key] : undefined;
  // DECISION (M0 tests): the unknown-key branch carries its own Persian copy ("تنظیم ناشناخته",
  // header EDGE CASE 1) and never echoes the key back into `fa` (the spec: `fa` leaks nothing).
  if (schema === undefined) {
    throw appError("VALIDATION", { fa: "تنظیم ناشناخته", details: [{ path: "key", message: "تنظیم ناشناخته" }] });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw appError("VALIDATION", {
      details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return parsed.data as Settings[K];
}
