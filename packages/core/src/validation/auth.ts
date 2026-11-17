import { z } from "zod";
import { GENDERS, OTP_CODE_LEN, OTP_PURPOSES } from "../constants";
import { zBool, zDigits, zEmail, zIsoDate, zPhone, zText, FA } from "./common";

export const phoneSchema = zPhone;
export const otpCodeSchema = zDigits(OTP_CODE_LEN);
export const otpPurposeSchema = z.enum(OTP_PURPOSES);
export const powTokenSchema = zText(2048, 16);

export const otpRequestSchema = z
  .object({
    phone: phoneSchema,
    purpose: otpPurposeSchema,
    powToken: powTokenSchema.optional(),
  })
  .strict();

export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    code: otpCodeSchema,
    purpose: otpPurposeSchema,
  })
  .strict();

const MIN_BIRTHDAY = "1900-01-01";

export const profileSchema = z
  .object({
    firstName: zText(40, 2),
    lastName: zText(40, 2),
    email: zEmail.nullable().optional(),
    birthday: zIsoDate
      .refine((d) => d >= MIN_BIRTHDAY && d < new Date().toISOString().slice(0, 10), FA.invalid)
      .nullable()
      .optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    marketingOptIn: zBool.optional(),
  })
  .strict();

export const phoneChangeRequestSchema = z.object({ phone: phoneSchema }).strict();
export const phoneChangeVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema }).strict();

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type PhoneChangeRequestInput = z.infer<typeof phoneChangeRequestSchema>;
export type PhoneChangeVerifyInput = z.infer<typeof phoneChangeVerifySchema>;
