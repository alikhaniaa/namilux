import { z } from "zod";
import { MAX_TOMAN } from "./common";

const money = z.number().int().min(0).max(MAX_TOMAN);
const prices = z.object({ price: money, compareAtPrice: money.nullable() }).strict();

const row = z.object({
  id: z.number().int().positive(),
  before: prices,
  after: prices.refine((p) => p.compareAtPrice === null || (p.price > 0 && p.compareAtPrice > p.price), {
    message: "قیمت قبل از تخفیف باید بیشتر از قیمت فروش باشد.",
  }),
}).strict();
const rows = (max: number) =>
  z.array(row).min(1).max(max).refine((list) => new Set(list.map((r) => r.id)).size === list.length, "کالای تکراری");

/** The most rows one save may carry. */
export const PRICE_SHEET_MAX = 2000;
/**
 * The most rows a hand edit may carry in one request. Typing prices row by row saves each as it is
 * confirmed; a few may ride together when the previous request is still on the wire.
 */
export const PRICE_EDIT_MAX = 25;

export const priceSheetSchema = z.object({ rows: rows(PRICE_SHEET_MAX), note: z.string().trim().max(200).optional() }).strict();

/** Same shape, hand-edit sized: what a person types one row at a time, never a formula's output. */
export const priceEditSchema = z.object({ rows: rows(PRICE_EDIT_MAX), note: z.string().trim().max(200).optional() }).strict();

export type PriceSheetInput = z.infer<typeof priceSheetSchema>;
export type PriceEditInput = z.infer<typeof priceEditSchema>;
