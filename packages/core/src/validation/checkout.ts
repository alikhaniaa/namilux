import { z } from "zod";
import {
  COUPON_CODE_MAX_LEN,
  COUPON_CODE_MIN_LEN,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
  MAX_WISHLIST_ITEMS,
  ORDER_CODE_RE,
  WEB_PAYMENT_METHODS,
} from "../constants";
import { addressSchema, citySchema, provinceCodeSchema } from "./address";
import { phoneSchema } from "./auth";
import { cleanFold, uniqueBy, zBool, zHex, zId, zInt, zIsoDateTime, zMultiline, zUlid, FA } from "./common";

export const cartLineSchema = z
  .object({
    productId: zId,
    qty: zInt(1, MAX_QTY_PER_LINE),
  })
  .strict();

const uniqueLines = (lines: { productId: number }[]) => uniqueBy(lines, (l) => l.productId);

export const cartLinesSchema = z
  .array(cartLineSchema)
  .min(1, FA.required)
  .max(MAX_CART_LINES, FA.tooLong)
  .refine(uniqueLines, FA.invalid);

export const couponCodeSchema = z.preprocess(
  (v) => {
    const c = cleanFold(v);
    return typeof c === "string" ? c.toUpperCase() : c;
  },
  z.string().regex(new RegExp(`^[A-Z0-9]{${COUPON_CODE_MIN_LEN},${COUPON_CODE_MAX_LEN}}$`), FA.invalid),
);

export const shippingKeySchema = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, FA.invalid);

export const orderCodeSchema = z.preprocess(
  (v) => {
    const c = cleanFold(v);
    return typeof c === "string" ? c.toUpperCase() : c;
  },
  z.string().regex(ORDER_CODE_RE, FA.invalid),
);

export const quoteAddressRefSchema = z.union([
  zUlid,
  z.object({ province: provinceCodeSchema, city: citySchema }).strict(),
]);

export const quoteRequestSchema = z
  .object({
    lines: cartLinesSchema,
    couponCode: couponCodeSchema.optional(),
    usePoints: zBool.optional(),
    shippingKey: shippingKeySchema.optional(),
    addressId: quoteAddressRefSchema.optional(),
  })
  .strict();

export const placeRequestSchema = z
  .object({
    quoteSig: zHex(32),
    expectedGrandTotal: zInt(0, Number.MAX_SAFE_INTEGER).optional(),
    lines: cartLinesSchema,
    couponCode: couponCodeSchema.optional(),
    usePoints: zBool.optional(),
    shippingKey: shippingKeySchema,
    addressId: zUlid.optional(),
    address: addressSchema.optional(),
    note: zMultiline(500).optional(),
    gift: z.object({ message: zMultiline(300) }).strict().optional(),
    paymentMethod: z.enum(WEB_PAYMENT_METHODS),
  })
  .strict()
  .refine((r) => (r.addressId ? 1 : 0) + (r.address ? 1 : 0) === 1, {
    message: FA.invalid,
    path: ["addressId"],
  });

export const trackRequestSchema = z
  .object({
    code: orderCodeSchema,
    phone: phoneSchema,
  })
  .strict();

export const cartSyncSchema = z
  .object({
    lines: z.array(cartLineSchema).max(MAX_CART_LINES, FA.tooLong).refine(uniqueLines, FA.invalid),
    updatedAt: zIsoDateTime,
  })
  .strict();

export const wishlistSyncSchema = z
  .object({
    ids: z
      .array(zId)
      .max(MAX_WISHLIST_ITEMS, FA.tooLong)
      .refine((ids) => uniqueBy(ids, (i) => i), FA.invalid),
  })
  .strict();

export const returnRequestSchema = z
  .object({
    orderCode: orderCodeSchema,
    reason: zMultiline(500, 10),
    items: z.array(cartLineSchema).max(MAX_CART_LINES).refine(uniqueLines, FA.invalid).optional(),
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    orderCode: orderCodeSchema,
    reason: zMultiline(300).optional(),
  })
  .strict();

export const retryPaymentSchema = z.object({ orderCode: orderCodeSchema }).strict();
export const orderCodeParamSchema = z.object({ code: orderCodeSchema }).strict();

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type QuoteAddressRef = z.infer<typeof quoteAddressRefSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type PlaceRequest = z.infer<typeof placeRequestSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type CartSyncInput = z.infer<typeof cartSyncSchema>;
export type WishlistSyncInput = z.infer<typeof wishlistSyncSchema>;
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
