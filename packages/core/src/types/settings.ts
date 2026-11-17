import type { Settings, SettingsKey } from "../settings/schema";

export type { Settings, SettingsKey };

// DECISION (M0 step 3): settings/schema.ts exports Settings/SettingsKey only, so the
// `SettingValue<K>` of this file's contract is defined here as an alias over Settings - no shape is
// redeclared, schema.ts stays the single source of truth.
export type SettingValue<K extends SettingsKey> = Settings[K];

export type StoreInfoSetting = Settings["store.info"];
export type StoreContactSetting = Settings["store.contact"];
export type StoreHoursSetting = Settings["store.hours"];
export type StoreSocialSetting = Settings["store.social"];
export type MaintenanceSetting = Settings["commerce.maintenance"];
export type InstallmentsSetting = Settings["commerce.installments"];
export type ShippingCopySetting = Settings["shipping.copy"];
export type LoyaltyRulesSetting = Settings["loyalty.rules"];
/**
 * DECISION (M0 step 3): declared structurally here instead of `Settings["otp.limits"]`.
 * settings/schema.ts builds the "otp.limits" entry from ../auth/quota.otpLimitsSchema, which is
 * annotated `z.ZodType<OtpLimits>`; aliasing `Settings` would make the alias circular (TS2456).
 * Same pattern as LoyaltyRules in ./customer.ts - settings/__tests__/schema.test.ts asserts the
 * shape still matches the schema.
 */
export type OtpLimits = {
  phonePer10m: number;
  phonePerDay: number;
  ipPer10m: number;
  uaPerDay: number;
  cooldownSec: number;
  captchaAfter: number;
  global10m: number;
  pauseMultiplier: number;
  verifyIpPer10m: number;
};
export type SmsTemplates = Settings["sms.templates"];
// DECISION (M0 step 3): the settings key is "notify.telegram" (settings/schema.ts,
// the spec); the old "notify.telegram_chat_id" alias did not exist.
export type TelegramNotifySetting = Settings["notify.telegram"];
export type PromoBarSetting = Settings["promo.bar"];
export type SeoDefaultsSetting = Settings["seo.defaults"];
export type PwaCoachSetting = Settings["pwa.coach"];
export type AnalyticsSamplingSetting = Settings["analytics.sampling"];

// DECISION: `maintenanceMessage` belongs here - `settings/service.effectiveFlags` returns all
// three (its contract and the spec §settings both say so) and the shell needs the message to
// render the maintenance page. Absorbed at M1 so service.ts stops widening the type locally.
export type EffectiveFlags = { checkoutEnabled: boolean; maintenance: boolean; maintenanceMessage: string };
