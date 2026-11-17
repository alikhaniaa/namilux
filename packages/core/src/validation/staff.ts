import { z } from "zod";
import { ROLE_NAMES, STAFF_PASSWORD_MIN_LEN } from "../constants";
import { stripControl } from "../persian/normalize";
import { zBool, zDigits, zEmail, zHex, zPhone, zText, zUlid, FA } from "./common";

export const staffEmailSchema = zEmail;

/**
 * What a staff member types in the «نام کاربری» box to log in. `staff_users.email` is the column
 * behind it and an address is still the normal case, but the owner may also hand a new admin a
 * plain username or their mobile number - three shapes, one lower-cased string, one unique index:
 *
 *   staff@namilux.ir      an e-mail address (zEmail: trimmed, lower-cased, a real TLD required)
 *   ali.karimi          a username: 3–40 of a-z 0-9 . _ - , starting and ending on a letter/digit
 *   09121230077         an Iranian mobile, folded from Persian digits by normalizePhone
 *
 * A username may not contain «@», so `owner@namilux` (an address with no TLD) is still rejected - 
 * it is a malformed e-mail rather than a username, and always was.
 */
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])$/;

export const staffIdentitySchema = z.union([
  zEmail,
  zPhone,
  z.preprocess(
    (v) => (typeof v === "string" ? stripControl(v).trim().toLowerCase() : v),
    z.string().regex(USERNAME_RE, FA.invalid),
  ),
]);

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

export const staffPasswordSchema = z
  .string()
  .min(STAFF_PASSWORD_MIN_LEN, FA.tooShort)
  .max(256, FA.tooLong)
  .refine((p) => !CONTROL_RE.test(p), FA.invalid);

export const totpCodeSchema = zDigits(6);

export const staffLoginSchema = z
  .object({
    // The field is still named `email` on the wire (the login page and every existing client post
    // that key); what it accepts is the identity above, so a username or a phone logs in too.
    email: staffIdentitySchema,
    password: staffPasswordSchema,
  })
  .strict();

export const staffTotpSchema = z
  .object({
    tempToken: zHex(32),
    code: totpCodeSchema,
  })
  .strict();

export const staffSudoSchema = z.object({ code: totpCodeSchema }).strict();
export const totpEnrolConfirmSchema = z.object({ code: totpCodeSchema }).strict();

export const staffInviteSchema = z
  .object({
    email: staffEmailSchema,
    name: zText(80, 2),
    role: z.enum(ROLE_NAMES),
  })
  .strict();

/**
 * The owner's «افزودن کارمند» form. `password` is optional: leaving it empty makes the server
 * generate a one-time password and return it ONCE, which is what the dialog shows and the owner
 * reads out. The new account is active immediately with `must_change_password`, so the existing
 * first-login flow (password → TOTP enrolment) runs unchanged.
 */
export const staffCreateSchema = z
  .object({
    email: staffIdentitySchema,
    name: zText(80, 2),
    role: z.enum(ROLE_NAMES),
    password: staffPasswordSchema.optional(),
  })
  .strict();

export const staffAcceptInviteSchema = z
  .object({
    token: zHex(32),
    password: staffPasswordSchema,
  })
  .strict();

export const staffUpdateSchema = z
  .object({
    role: z.enum(ROLE_NAMES).optional(),
    isActive: zBool.optional(),
    name: zText(80, 2).optional(),
    /** Clears the stored TOTP secret so the next login re-enrols an authenticator app. */
    forceTotpReenrol: zBool.optional(),
    /** Issues a fresh one-time password, returned once and never stored in the clear. */
    resetPassword: zBool.optional(),
  })
  .strict()
  .refine(
    (u) =>
      u.role !== undefined ||
      u.isActive !== undefined ||
      u.name !== undefined ||
      u.forceTotpReenrol !== undefined ||
      u.resetPassword !== undefined,
    { message: FA.required },
  );

export const passwordChangeSchema = z
  .object({
    current: staffPasswordSchema,
    next: staffPasswordSchema,
  })
  .strict()
  .refine((p) => p.current !== p.next, { message: FA.invalid, path: ["next"] });

export const staffSessionRevokeSchema = z.object({ sessionId: zUlid }).strict();
export const staffIdParamSchema = z.object({ id: zUlid }).strict();

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
export type StaffTotpInput = z.infer<typeof staffTotpSchema>;
export type StaffSudoInput = z.infer<typeof staffSudoSchema>;
export type StaffInviteInput = z.infer<typeof staffInviteSchema>;
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;
export type StaffAcceptInviteInput = z.infer<typeof staffAcceptInviteSchema>;
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
