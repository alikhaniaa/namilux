import { z } from "zod";
import { ULID_RE } from "../constants";
import { enDigits } from "../persian/format";
import { stripControl } from "../persian/normalize";
import { normalizePhone } from "../persian/phone";

export const MAX_TOMAN = 10_000_000_000_000;

export const FA = {
  required: "این فیلد الزامی است.",
  phone: "شمارهٔ موبایل معتبر نیست.",
  otp: "کد باید ۶ رقم باشد.",
  postcode: "کد پستی باید ۱۰ رقم باشد.",
  email: "نشانی ایمیل معتبر نیست.",
  tooLong: "متن طولانی‌تر از حد مجاز است.",
  tooShort: "متن کوتاه‌تر از حد مجاز است.",
  invalid: "مقدار معتبر نیست.",
  city: "شهر انتخاب‌شده در این استان نیست.",
} as const;

export const clean = (v: unknown): unknown => (typeof v === "string" ? stripControl(v).trim() : v);

export const cleanFold = (v: unknown): unknown => (typeof v === "string" ? enDigits(stripControl(v)).trim() : v);

export const cleanNumber = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const s = enDigits(stripControl(v)).replace(/[٬,\s]/g, "");
  if (s === "" || !/^-?\d+(?:\.\d+)?$/.test(s)) return v;
  return Number(s);
};

export const zText = (max: number, min = 0) =>
  z.preprocess(clean, z.string().min(min, FA.tooShort).max(max, FA.tooLong));

export const zTextFold = (max: number, min = 0) =>
  z.preprocess(cleanFold, z.string().min(min, FA.tooShort).max(max, FA.tooLong));

export const zMultiline = (max: number, min = 0) =>
  z.preprocess(clean, z.string().min(min, FA.tooShort).max(max, FA.tooLong));

export const zDigits = (len: number) =>
  z.preprocess(cleanFold, z.string().regex(new RegExp(`^\\d{${len}}$`), FA.invalid));

export const zTomanInput = z.preprocess(cleanNumber, z.number().int(FA.invalid).min(0, FA.invalid).max(MAX_TOMAN, FA.invalid));

export const zInt = (min: number, max: number) =>
  z.preprocess(cleanNumber, z.number().int(FA.invalid).min(min, FA.invalid).max(max, FA.invalid));

export const zId = z.preprocess(cleanNumber, z.number().int().min(1).max(2_147_483_647));

export const zUlid = z.string().regex(ULID_RE, FA.invalid);

export const zHex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`), FA.invalid);

export const zSlug = z.preprocess(
  clean,
  z
    .string()
    .min(1, FA.required)
    .max(200, FA.tooLong)
    .regex(/^[^\s/?#%\\]+$/, FA.invalid)
    .refine((s) => !s.includes(".."), FA.invalid),
);

export const zLatinSlug = z.preprocess(clean, z.string().max(80, FA.tooLong).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, FA.invalid));

export const zLatinKey = z.preprocess(clean, z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, FA.invalid));

export const zPath = z.preprocess(
  clean,
  z
    .string()
    .max(512, FA.tooLong)
    .regex(/^\/(?:[^\s/][^\s]*)?$/, FA.invalid)
    .refine((s) => s.endsWith("/") && !s.includes("..") && !s.includes("//"), FA.invalid),
);

export const zHref = z.preprocess(
  clean,
  z
    .string()
    .max(512, FA.tooLong)
    .refine((s) => {
      if (/\s/.test(s) || s.includes("..")) return false;
      if (s.startsWith("https://")) return s.length > 8;
      return s.startsWith("/") && !s.startsWith("//");
    }, FA.invalid),
);

export const zIsoDateTime = z.iso.datetime({ offset: true, message: FA.invalid });
export const zIsoDate = z.iso.date({ message: FA.invalid });

export const zEmail = z.preprocess(
  (v) => (typeof v === "string" ? stripControl(v).trim().toLowerCase() : v),
  z.email({ message: FA.email }).max(254, FA.tooLong),
);

export const zPhone = z.preprocess(
  cleanFold,
  z
    .string()
    .refine((v) => normalizePhone(v) !== null, FA.phone)
    .transform((v) => normalizePhone(v) as string),
);

export const zBool = z.boolean();

export const zSort = zInt(0, 100_000).default(0);

export function uniqueBy<T>(arr: readonly T[], key: (t: T) => unknown): boolean {
  const seen = new Set<unknown>();
  for (const item of arr) {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

export function issuesToDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}
