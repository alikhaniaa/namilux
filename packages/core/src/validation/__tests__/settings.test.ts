import { describe, expect, it } from "vitest";
import { SETTINGS_KEYS, parseSettingValue as schemaParse, settingsKeySchemas } from "../../settings/schema";
import {
  parseSettingValue,
  setSettingSchema,
  settingKeyParamSchema,
  settingsKeySchema,
  settingsSchemas,
} from "../settings";

describe("key param enum", () => {
  it("accepts every settings key and refuses anything else", () => {
    for (const key of SETTINGS_KEYS) {
      expect(settingKeyParamSchema.parse({ key }), key).toEqual({ key });
      expect(settingsKeySchema.parse(key)).toBe(key);
    }
    for (const bad of ["store.nope", "STORE.INFO", "store", "", "__proto__", "constructor", "toString", 1, null]) {
      expect(() => settingKeyParamSchema.parse({ key: bad }), JSON.stringify(bad)).toThrow();
      expect(() => settingsKeySchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it("is strict - no value may ride along on the path parameter", () => {
    expect(() => settingKeyParamSchema.parse({ key: "store.info", value: {} })).toThrow();
    expect(() => settingKeyParamSchema.parse({})).toThrow();
  });
});

describe("body and re-exports", () => {
  it("setSettingSchema carries exactly one `value` key", () => {
    expect(setSettingSchema.parse({ value: { brandName: "نامی لوکس" } })).toEqual({
      value: { brandName: "نامی لوکس" },
    });
    expect(setSettingSchema.parse({ value: null })).toEqual({ value: null });
    expect(setSettingSchema.parse({ value: 5 })).toEqual({ value: 5 });
    expect(() => setSettingSchema.parse({ value: 5, key: "commerce.vat_percent" })).toThrow();
    // the body is only a carrier - parseSettingValue is what actually validates `value` per key
    expect(() => parseSettingValue("commerce.vat_percent", setSettingSchema.parse({ value: 30 }).value)).toThrow();
  });

  it("re-exports the settings/schema definitions rather than duplicating a shape", () => {
    expect(settingsSchemas).toBe(settingsKeySchemas);
    expect(parseSettingValue).toBe(schemaParse);
    expect(Object.keys(settingsSchemas).sort()).toEqual([...SETTINGS_KEYS].sort());
    expect(parseSettingValue("commerce.max_per_order", 5)).toBe(5);
  });
});
