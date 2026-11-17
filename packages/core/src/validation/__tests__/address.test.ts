import { describe, expect, it } from "vitest";
import { PROVINCE_CODES } from "../../geo/provinces";
import { addressIdParamSchema, addressSchema, citySchema, postcodeSchema, provinceCodeSchema } from "../address";
import { FA } from "../common";

const valid = {
  recipientName: "علی رضایی",
  recipientPhone: "09121230077",
  province: "THR",
  city: "تهران",
  address: "خیابان ولیعصر، کوچهٔ دوم، پلاک ۱۲",
  postcode: "1391654321",
};

describe("valid address parses and canonicalizes city", () => {
  it("fills the defaults and normalizes every field", () => {
    const parsed = addressSchema.parse({ ...valid, city: "تهران " });
    expect(parsed).toEqual({
      label: "خانه",
      recipientName: "علی رضایی",
      recipientPhone: "09121230077",
      province: "THR",
      city: "تهران",
      address: "خیابان ولیعصر، کوچهٔ دوم، پلاک ۱۲",
      postcode: "1391654321",
      isDefault: false,
    });
  });

  it("keeps the optional fields and folds their digits", () => {
    const parsed = addressSchema.parse({
      ...valid,
      label: "محل کار",
      plaque: "۱۲",
      unit: "۴",
      isDefault: true,
      recipientPhone: "+98 912 123 0077",
    });
    expect(parsed.label).toBe("محل کار");
    expect(parsed.plaque).toBe("12");
    expect(parsed.unit).toBe("4");
    expect(parsed.isDefault).toBe(true);
    expect(parsed.recipientPhone).toBe("09121230077");
  });

  it("canonicalizes an Arabic-letter city spelling to the dataset spelling", () => {
    const parsed = addressSchema.parse({ ...valid, province: "EAZ", city: " تبريز " });
    expect(parsed.city).toBe("تبریز");
    expect(parsed.city).not.toMatch(/[يك]/);
  });

  it("provinceCodeSchema is exactly the geo dataset", () => {
    for (const code of PROVINCE_CODES) expect(provinceCodeSchema.parse(code)).toBe(code);
    for (const bad of ["XX", "thr", "TEHRAN", "", 1]) expect(() => provinceCodeSchema.parse(bad)).toThrow();
    expect(citySchema.parse(" تهران ")).toBe("تهران");
    expect(() => citySchema.parse("ت")).toThrow();
    expect(() => citySchema.parse("ش".repeat(81))).toThrow();
  });
});

describe("city must belong to province", () => {
  it("reports the mismatch at ['city'] with the Persian message", () => {
    const r = addressSchema.safeParse({ ...valid, province: "THR", city: "تبریز" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["city"]);
    expect(r.error?.issues[0]?.message).toBe(FA.city);
  });

  it("rejects an invented city", () => {
    expect(() => addressSchema.parse({ ...valid, city: "شهر ناکجاآباد" })).toThrow();
    expect(() => addressSchema.parse({ ...valid, city: "Tehran" })).toThrow();
  });
});

describe("postcode folding", () => {
  it("folds digits and drops spaces and dashes", () => {
    expect(postcodeSchema.parse("۱۳۹۱۶ ۵۴۳۲۱")).toBe("1391654321");
    expect(postcodeSchema.parse("13916-54321")).toBe("1391654321");
    expect(postcodeSchema.parse(" ۱۳۹۱۶۵۴۳۲۱ ")).toBe("1391654321");
    expect(addressSchema.parse({ ...valid, postcode: "۱۳۹۱۶ ۵۴۳۲۱" }).postcode).toBe("1391654321");
  });

  it("needs exactly ten digits", () => {
    for (const bad of ["139165432", "12345678901", "13916543a1", "", "۱۳۹۱۶٬۵۴۳۲۱", 1391654321]) {
      expect(() => postcodeSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    const r = postcodeSchema.safeParse("139165432");
    expect(r.error?.issues[0]?.message).toBe(FA.postcode);
  });
});

describe("strict", () => {
  it("rejects an unknown key", () => {
    expect(() => addressSchema.parse({ ...valid, geoLat: 35.7 })).toThrow();
    expect(() => addressSchema.parse({ ...valid, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toThrow();
    expect(() => addressSchema.parse({ ...valid, customerId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toThrow();
  });

  it("drops an own __proto__ property without polluting Object.prototype", () => {
    const polluted = JSON.parse(JSON.stringify({ ...valid })) as Record<string, unknown>;
    const raw = JSON.parse(`{"__proto__":{"hacked":true}}`) as Record<string, unknown>;
    const parsed = addressSchema.parse({ ...raw, ...polluted });
    expect(parsed.city).toBe("تهران");
    expect(({} as Record<string, unknown>).hacked).toBeUndefined();
  });

  it("enforces the field bounds", () => {
    expect(() => addressSchema.parse({ ...valid, address: "کوتاه" })).toThrow(); // < 10 chars
    expect(() => addressSchema.parse({ ...valid, address: "x".repeat(501) })).toThrow();
    expect(() => addressSchema.parse({ ...valid, recipientName: "ع" })).toThrow();
    expect(() => addressSchema.parse({ ...valid, label: "" })).toThrow();
    expect(() => addressSchema.parse({ ...valid, plaque: "۱".repeat(21) })).toThrow();
    expect(() => addressSchema.parse({ ...valid, recipientPhone: "02155550000" })).toThrow();
    expect(() => addressSchema.parse({ ...valid, isDefault: "true" })).toThrow();
    for (const key of ["recipientName", "recipientPhone", "province", "city", "address", "postcode"]) {
      const partial = { ...valid } as Record<string, unknown>;
      delete partial[key];
      expect(() => addressSchema.parse(partial), key).toThrow();
    }
  });

  it("addressIdParamSchema takes a ULID only", () => {
    expect(addressIdParamSchema.parse({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).toEqual({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(() => addressIdParamSchema.parse({ id: "1" })).toThrow();
    expect(() => addressIdParamSchema.parse({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", customerId: "x" })).toThrow();
  });
});
