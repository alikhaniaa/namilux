import { z } from "zod";
import { zInt, zMultiline, zText, zUlid, FA } from "./common";

export const ratingSchema = zInt(1, 5);

export const reviewSchema = z
  .object({
    rating: ratingSchema,
    title: zText(80, 3),
    body: zMultiline(2000, 20),
    pros: z.array(zText(80, 1)).max(5, FA.tooLong).optional(),
    cons: z.array(zText(80, 1)).max(5, FA.tooLong).optional(),
  })
  .strict();

export const reviewModerateSchema = z
  .object({
    status: z.enum(["approved", "rejected"]),
    reply: zMultiline(1000).optional(),
  })
  .strict();

export const reviewHelpfulSchema = z.object({ reviewId: zUlid }).strict();

export const reviewListQuerySchema = z
  .object({
    page: zInt(1, 500).default(1),
    sort: z.enum(["newest", "helpful", "rating_desc", "rating_asc"]).default("newest"),
  })
  .strict();

export type ReviewInput = z.infer<typeof reviewSchema>;
export type ReviewModerateInput = z.infer<typeof reviewModerateSchema>;
export type ReviewHelpfulInput = z.infer<typeof reviewHelpfulSchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
