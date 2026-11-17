import { z } from "zod";
import { otpCodeSchema, phoneSchema, powTokenSchema } from "./auth";
import { zBool, zId, zIsoDateTime, zMultiline, zText, zTomanInput, zUlid, FA } from "./common";

export const backInStockSchema = z
  .object({
    phone: phoneSchema,
    code: otpCodeSchema.optional(),
  })
  .strict();

export const conciergeSchema = z
  .object({
    productId: zId,
    phone: phoneSchema,
    code: otpCodeSchema.optional(),
    note: zMultiline(500).optional(),
  })
  .strict();

export const questionSchema = z
  .object({
    body: zMultiline(1000, 10),
  })
  .strict();

export const contactSchema = z
  .object({
    name: zText(80, 2),
    phone: phoneSchema,
    message: zMultiline(2000, 10),
    powToken: powTokenSchema,
  })
  .strict();

export const newsletterSchema = z
  .object({
    phone: phoneSchema,
    optIn: z.literal(true),
    powToken: powTokenSchema,
  })
  .strict();

export const questionAnswerSchema = z
  .object({
    answer: zMultiline(2000, 1),
    sendSms: zBool.default(false),
    promoteToFaq: zBool.default(false),
  })
  .strict();

export const conciergeReplySchema = z
  .object({
    message: zMultiline(300, 1),
    price: zTomanInput.optional(),
    publishPrice: zBool.default(false),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.publishPrice && !(typeof r.price === "number" && r.price > 0)) {
      ctx.addIssue({ code: "custom", path: ["price"], message: FA.invalid });
    }
  });

export const inboxAssignSchema = z.object({ staffId: zUlid.nullable() }).strict();
export const inboxSnoozeSchema = z.object({ until: zIsoDateTime }).strict();
export const productIdParamSchema = z.object({ id: zId }).strict();

export type BackInStockInput = z.infer<typeof backInStockSchema>;
export type ConciergeInput = z.infer<typeof conciergeSchema>;
export type QuestionInput = z.infer<typeof questionSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type NewsletterInput = z.infer<typeof newsletterSchema>;
export type QuestionAnswerInput = z.infer<typeof questionAnswerSchema>;
export type ConciergeReplyInput = z.infer<typeof conciergeReplySchema>;
