import { describe, expect, it } from "vitest";
import { isAppError } from "../../errors";
import type {
  AnalyticsSamplingSetting,
  InstallmentsSetting,
  MaintenanceSetting,
  OtpLimits,
  PromoBarSetting,
  PwaCoachSetting,
  SeoDefaultsSetting,
  Settings as SettingsAlias,
  SettingValue,
  ShippingCopySetting,
  SmsTemplates,
  StoreContactSetting,
  StoreHoursSetting,
  StoreInfoSetting,
  TelegramNotifySetting,
} from "../../types/settings";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEYS,
  parseSettingValue,
  settingsKeySchemas,
  settingsSchema,
  type Settings,
  type SettingsKey,
} from "../schema";

/**
 * the spec, verbatim. `notify.telegram_chat_id` is listed there but settings/schema.ts (which
 * DONE) renamed it to `notify.telegram` in its own DECISION comment (the value grew a chatId +
 * events object), so the doc name is mapped here rather than asserted literally.
 */
const DOC_02_KEYS = [
  "store.info", "store.contact", "store.hours", "store.social", "seals.enamad_code", "seals.samandehi_code",
  "commerce.checkout_enabled", "commerce.maintenance", "commerce.max_per_order", "commerce.pending_ttl_min",
  "commerce.vat_percent", "commerce.installments", "shipping.copy", "loyalty.rules", "otp.limits",
  "sms.templates", "notify.telegram", "promo.bar", "seo.defaults", "pwa.coach", "analytics.sampling",
] as const;

// ---------------------------------------------------------------- type-level assertions
type Equal<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _Settings = Expect<Equal<SettingsAlias, Settings>>;
type _Value = Expect<Equal<SettingValue<"flags">, Settings["flags"]>>;
type _Info = Expect<Equal<StoreInfoSetting, Settings["store.info"]>>;
type _Contact = Expect<Equal<StoreContactSetting, Settings["store.contact"]>>;
type _Hours = Expect<Equal<StoreHoursSetting, Settings["store.hours"]>>;
type _Maint = Expect<Equal<MaintenanceSetting, Settings["commerce.maintenance"]>>;
type _Inst = Expect<Equal<InstallmentsSetting, Settings["commerce.installments"]>>;
type _Ship = Expect<Equal<ShippingCopySetting, Settings["shipping.copy"]>>;
type _Sms = Expect<Equal<SmsTemplates, Settings["sms.templates"]>>;
type _Tg = Expect<Equal<TelegramNotifySetting, Settings["notify.telegram"]>>;
type _Promo = Expect<Equal<PromoBarSetting, Settings["promo.bar"]>>;
type _Seo = Expect<Equal<SeoDefaultsSetting, Settings["seo.defaults"]>>;
type _Coach = Expect<Equal<PwaCoachSetting, Settings["pwa.coach"]>>;
type _Sampling = Expect<Equal<AnalyticsSamplingSetting, Settings["analytics.sampling"]>>;
type _Otp = Expect<Equal<OtpLimits, Settings["otp.limits"]>>;

describe("keys", () => {
  it("DEFAULT_SETTINGS parses with every key from the spec", () => {
    expect(() => settingsSchema.parse({})).not.toThrow();
    for (const key of DOC_02_KEYS) {
      expect(SETTINGS_KEYS, key).toContain(key);
      expect(DEFAULT_SETTINGS[key], key).not.toBeUndefined();
      expect(settingsKeySchemas[key], key).toBeDefined();
    }
    // Beyond the spec: `flags` (schema.ts contract / the spec §settings) and `system.contract`
    // (written by `check:contract --record`, read by the admin health panel - that tool's own
    // contract names the key; added to the schema at M1 so getSettings stops warning about it),
    // plus the instalment storefront's own trust seals (it is a different registered domain, so
    // نماد/ساماندهی issue it a second pair of codes).
    expect(SETTINGS_KEYS.filter((k) => !(DOC_02_KEYS as readonly string[]).includes(k))).toEqual([
      "seals.enamad_code_instalments",
      "seals.samandehi_code_instalments",
      "flags",
      "system.contract",
    ]);
    expect(new Set(SETTINGS_KEYS).size).toBe(SETTINGS_KEYS.length);
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(Object.keys(settingsKeySchemas).sort()).toEqual([...SETTINGS_KEYS].sort());
  });

  it("every key has a default and re-parsing the defaults is a no-op", () => {
    for (const key of SETTINGS_KEYS) {
      expect(parseSettingValue(key, DEFAULT_SETTINGS[key]), key).toEqual(DEFAULT_SETTINGS[key]);
    }
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("the decided defaults of the spec §11 hold", () => {
    expect(DEFAULT_SETTINGS["store.info"].brandName).toBe("نامی لوکس");
    expect(DEFAULT_SETTINGS["store.info"].wordmark).toContain("‌"); // ZWNJ
    expect(DEFAULT_SETTINGS["store.contact"].phoneMobile).toBe("09121230077");
    expect(DEFAULT_SETTINGS["store.hours"].note).toMatch(/[۰-۹]/); // Persian digits
    expect(DEFAULT_SETTINGS["commerce.checkout_enabled"]).toBe(true);
    expect(DEFAULT_SETTINGS["commerce.maintenance"].enabled).toBe(false);
    expect(DEFAULT_SETTINGS["commerce.max_per_order"]).toBe(5);
    expect(DEFAULT_SETTINGS["commerce.pending_ttl_min"]).toBe(30);
    expect(DEFAULT_SETTINGS["commerce.vat_percent"]).toBe(0);
    expect(DEFAULT_SETTINGS["commerce.installments"].enabled).toBe(false);
    expect(DEFAULT_SETTINGS["promo.bar"]).toEqual({ enabled: true, rotateSec: 8 });
    expect(DEFAULT_SETTINGS["analytics.sampling"].retentionMonths).toBe(13);
    expect(DEFAULT_SETTINGS["seals.enamad_code"]).toBe("");
    expect(DEFAULT_SETTINGS.flags.reviews).toBe(true);
    expect(DEFAULT_SETTINGS.flags.push).toBe(false);
  });

  it("carries no secret-looking key (secrets are env only)", () => {
    expect(JSON.stringify(DEFAULT_SETTINGS)).not.toMatch(/secret|api_key|apiKey|password|merchant/i);
  });

  it("types/settings shapes match the schema (type-level assertion)", () => {
    // the `type _X = Expect<Equal<…>>` aliases above fail `pnpm --filter @namilux/core typecheck`
    // if an alias drifts; the runtime half checks the structural shape of the hand-written OtpLimits.
    const otp: OtpLimits = DEFAULT_SETTINGS["otp.limits"];
    expect(Object.keys(otp).sort()).toEqual(
      [
        "captchaAfter",
        "cooldownSec",
        "global10m",
        "ipPer10m",
        "pauseMultiplier",
        "phonePer10m",
        "phonePerDay",
        "uaPerDay",
        "verifyIpPer10m",
      ].sort(),
    );
    // DECISION (M0 lint): a tuple, not an intersection - every alias resolves to `true`, so
    // `_Settings & _Value & …` was fifteen duplicate constituents (no-duplicate-type-constituents)
    // that asserted nothing. Each position below still fails to compile if its alias drifts.
    const check: [
      _Settings,
      _Value,
      _Otp,
      _Sms,
      _Tg,
      _Info,
      _Contact,
      _Hours,
      _Maint,
      _Inst,
      _Ship,
      _Promo,
      _Seo,
      _Coach,
      _Sampling,
    ] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
    expect(check.every((ok) => ok)).toBe(true);
  });
});

// DECISION (M0 lint): vitest types `expect.objectContaining` as `any`, which reaches `toThrowError`
// as an unsafe argument. The cast is done once here instead of at every call site.
const validationError = (): Error => expect.objectContaining({ code: "VALIDATION" }) as Error;

describe("parseSettingValue", () => {
  it("unknown key is rejected with VALIDATION", () => {
    for (const key of ["store.nope", "", "flags2", "STORE.INFO"]) {
      let thrown: unknown;
      try {
        parseSettingValue(key as SettingsKey, {});
      } catch (e) {
        thrown = e;
      }
      expect(isAppError(thrown), key).toBe(true);
      if (!isAppError(thrown)) continue;
      expect(thrown.code).toBe("VALIDATION");
      expect(thrown.httpStatus).toBe(400);
      expect(thrown.fa).toBe("تنظیم ناشناخته");
    }
  });

  it("a prototype key is rejected, not resolved through Object.prototype", () => {
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(() => parseSettingValue(key as SettingsKey, {}), key).toThrowError(
        validationError(),
      );
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("vat_percent 30 is rejected", () => {
    expect(parseSettingValue("commerce.vat_percent", 25)).toBe(25);
    expect(parseSettingValue("commerce.vat_percent", 9)).toBe(9);
    for (const bad of [30, -1, 25.0001, "9", null, NaN, {}, []]) {
      expect(() => parseSettingValue("commerce.vat_percent", bad), JSON.stringify(bad)).toThrowError(
        validationError(),
      );
    }
    // every key carries a default, so `undefined` is a reset to that default, not an error (rules)
    expect(parseSettingValue("commerce.vat_percent", undefined)).toBe(DEFAULT_SETTINGS["commerce.vat_percent"]);
  });

  it("sms template over 2 segments is rejected", () => {
    // DECISION (M0 tests): the schema caps a template at 320 characters. The exact "≤ 2 SMS
    // segments" rule of the spec needs segmentsFor() from @namilux/integrations/sms/segments,
    // which was not yet built when this was written and which core may not import (integrations depends on core), so it
    // is reported rather than duplicated here. 321 Persian characters is ~5 UCS-2 segments.
    const long = "پ".repeat(321);
    expect(() => parseSettingValue("sms.templates", { otp: long })).toThrowError(
      validationError(),
    );
    expect(parseSettingValue("sms.templates", { otp: "کد ورود نامی‌لوکس: {code}" })).toEqual({
      otp: "کد ورود نامی‌لوکس: {code}",
    });
  });

  it("rejects out-of-range values per key and reports the failing path", () => {
    const cases: [SettingsKey, unknown][] = [
      ["commerce.max_per_order", 21],
      ["commerce.max_per_order", 0],
      ["commerce.max_per_order", 2.5],
      ["commerce.pending_ttl_min", 4],
      ["commerce.pending_ttl_min", 121],
      ["commerce.checkout_enabled", "true"],
      ["promo.bar", { enabled: true, rotateSec: 31 }],
      ["analytics.sampling", { pageviews: 2 }],
      ["notify.telegram", { chatId: "x", events: ["order.unknown"] }],
      ["otp.limits", { ...DEFAULT_SETTINGS["otp.limits"], phonePer10m: -1 }],
      ["store.hours", { days: { sat: { open: "10", close: "21:00" } } }],
    ];
    for (const [key, value] of cases) {
      let thrown: unknown;
      try {
        parseSettingValue(key, value);
      } catch (e) {
        thrown = e;
      }
      expect(isAppError(thrown), `${key}: ${JSON.stringify(value)}`).toBe(true);
      if (!isAppError(thrown)) continue;
      expect(thrown.code).toBe("VALIDATION");
      expect(Array.isArray(thrown.details)).toBe(true);
      for (const d of thrown.details as { path: string; message: string }[]) {
        expect(typeof d.path).toBe("string");
        expect(typeof d.message).toBe("string");
      }
    }
  });

  it("accepts a valid write for every key shape it guards", () => {
    expect(parseSettingValue("commerce.checkout_enabled", false)).toBe(false);
    expect(parseSettingValue("seals.enamad_code", "<a>seal</a>")).toBe("<a>seal</a>");
    expect(parseSettingValue("flags", { ...DEFAULT_SETTINGS.flags, push: true }).push).toBe(true);
    expect(parseSettingValue("notify.telegram", { chatId: "-100", events: ["order.paid"] })).toEqual({
      chatId: "-100",
      events: ["order.paid"],
    });
  });
});


it("uses the requested store hours and mobile-only contact defaults", () => {
  expect(DEFAULT_SETTINGS["store.contact"].phoneLand).toBe("");
  for (const day of Object.values(DEFAULT_SETTINGS["store.hours"].days)) {
    expect(day).toEqual({ open: "09:00", close: "18:00" });
  }
});
