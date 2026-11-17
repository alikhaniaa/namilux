import { z } from "zod";
import { PROVINCE_CODES, canonicalCity, cityExists } from "../geo/provinces";
import { phoneSchema } from "./auth";
import { cleanFold, zBool, zMultiline, zText, zTextFold, zUlid, FA } from "./common";

export const provinceCodeSchema = z.enum(PROVINCE_CODES);
export const citySchema = zText(80, 2);

export const postcodeSchema = z.preprocess(
  (v) => {
    const c = cleanFold(v);
    return typeof c === "string" ? c.replace(/[\s-]/g, "") : c;
  },
  z.string().regex(/^\d{10}$/, FA.postcode),
);

export const addressSchema = z
  .object({
    label: zText(40, 1).default("خانه"),
    recipientName: zText(80, 2),
    recipientPhone: phoneSchema,
    province: provinceCodeSchema,
    city: citySchema,
    address: zMultiline(500, 10),
    plaque: zTextFold(20).optional(),
    unit: zTextFold(20).optional(),
    postcode: postcodeSchema,
    isDefault: zBool.default(false),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (!cityExists(a.province, a.city)) {
      ctx.addIssue({ code: "custom", path: ["city"], message: FA.city });
    }
  })
  .transform((a) => ({ ...a, city: canonicalCity(a.province, a.city) ?? a.city }));

export const addressIdParamSchema = z.object({ id: zUlid }).strict();

export type AddressInput = z.infer<typeof addressSchema>;
