import { describe, expect, it } from "vitest";
import { ROLE_NAMES, STAFF_PASSWORD_MIN_LEN } from "../../constants";
import {
  passwordChangeSchema,
  staffAcceptInviteSchema,
  staffEmailSchema,
  staffIdParamSchema,
  staffCreateSchema,
  staffIdentitySchema,
  staffInviteSchema,
  staffLoginSchema,
  staffPasswordSchema,
  staffSessionRevokeSchema,
  staffSudoSchema,
  staffTotpSchema,
  staffUpdateSchema,
  totpEnrolConfirmSchema,
} from "../staff";

const PASSWORD = "correct horse battery";
const HEX = "a1b2c3d4".repeat(8);
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("login email normalization and password bounds", () => {
  it("trims and lowercases the email, keeps the password verbatim", () => {
    expect(staffLoginSchema.parse({ email: " Owner@Namilux.IR ", password: PASSWORD })).toEqual({
      email: "owner@namilux.ir",
      password: PASSWORD,
    });
    expect(staffEmailSchema.parse("Owner@Namilux.IR")).toBe("owner@namilux.ir");
    expect(() => staffLoginSchema.parse({ email: "owner@namilux", password: PASSWORD })).toThrow();
  });

  it("enforces the minimum length of the spec", () => {
    expect(STAFF_PASSWORD_MIN_LEN).toBe(12);
    expect(staffPasswordSchema.parse("a".repeat(12))).toBe("a".repeat(12));
    expect(() => staffPasswordSchema.parse("a".repeat(11))).toThrow();
    expect(() => staffLoginSchema.parse({ email: "owner@namilux.ir", password: "eleven.char" })).toThrow();
    expect(staffPasswordSchema.parse("a".repeat(256)).length).toBe(256);
    expect(() => staffPasswordSchema.parse("a".repeat(257))).toThrow();
    expect(() => staffPasswordSchema.parse(12345678901234)).toThrow();
    expect(() => staffLoginSchema.parse({ email: "owner@namilux.ir" })).toThrow();
    expect(() => staffLoginSchema.parse({ email: "owner@namilux.ir", password: PASSWORD, totp: "123456" })).toThrow();
  });
});

describe("the login identity: an e-mail, a username or a mobile", () => {
  it("accepts all three shapes and normalises them the same way everywhere", () => {
    expect(staffIdentitySchema.parse(" Owner@Namilux.IR ")).toBe("owner@namilux.ir");
    expect(staffIdentitySchema.parse(" Ali.Karimi ")).toBe("ali.karimi");
    expect(staffIdentitySchema.parse("ali_k-2")).toBe("ali_k-2");
    // Persian digits fold to Latin ones, as everywhere else a phone is read.
    expect(staffIdentitySchema.parse("۰۹۱۲۱۲۳۰۰۷۷")).toBe("09121230077");
    // Login takes the same identity, so a username or a phone can sign in.
    expect(staffLoginSchema.parse({ email: "Ali.Karimi", password: PASSWORD }).email).toBe("ali.karimi");
  });

  it("still refuses a malformed address and anything with an @ that is not one", () => {
    for (const bad of ["owner@namilux", "a@b", "ab", "-ali", "ali-", "ali karimi", "على", "a".repeat(41), ""]) {
      expect(() => staffIdentitySchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("the owner creates a staff member", () => {
  it("takes an identity, a name and a role; the password is optional", () => {
    expect(staffCreateSchema.parse({ email: " Ali.Karimi ", name: "علی کریمی", role: "admin" })).toEqual({
      email: "ali.karimi",
      name: "علی کریمی",
      role: "admin",
    });
    expect(staffCreateSchema.parse({ email: "a@b.ir", name: "زهرا", role: "admin", password: PASSWORD }).password).toBe(PASSWORD);
    for (const role of ROLE_NAMES) {
      expect(staffCreateSchema.parse({ email: "a@b.ir", name: "زهرا", role }).role).toBe(role);
    }
  });

  it("is strict: no extra key, no short name, no weak password, no unknown role", () => {
    expect(() => staffCreateSchema.parse({ email: "a@b.ir", name: "زهرا", role: "admin", isActive: true })).toThrow();
    expect(() => staffCreateSchema.parse({ email: "a@b.ir", name: "ز", role: "admin" })).toThrow();
    expect(() => staffCreateSchema.parse({ email: "a@b.ir", name: "زهرا", role: "admin", password: "eleven.char" })).toThrow();
    expect(() => staffCreateSchema.parse({ email: "a@b.ir", name: "زهرا", role: "superuser" })).toThrow();
    expect(() => staffCreateSchema.parse({ email: "owner@namilux", name: "زهرا", role: "admin" })).toThrow();
  });
});

describe("password keeps whitespace and rejects controls", () => {
  it("does not trim, fold or normalize the secret", () => {
    const padded = " padded xyz ";
    expect(padded.length).toBe(12);
    expect(staffPasswordSchema.parse(padded)).toBe(padded);
    expect(staffPasswordSchema.parse("۱۲۳۴۵۶۷۸۹۰۱۲")).toBe("۱۲۳۴۵۶۷۸۹۰۱۲"); // digits are NOT folded
    expect(staffPasswordSchema.parse("گذرواژهٔ فارسی")).toBe("گذرواژهٔ فارسی");
    expect(staffPasswordSchema.parse("a".repeat(11) + "\t")).toBe("a".repeat(11) + "\t");
  });

  it("rejects C0/C1 control characters", () => {
    for (const control of ["\u0000", "\u0007", "\u000B", "\u001B", "\u007F", "\u009F"]) {
      expect(() => staffPasswordSchema.parse("abcdefghijkl" + control), JSON.stringify(control)).toThrow();
      expect(() => staffPasswordSchema.parse(control + "abcdefghijkl"), JSON.stringify(control)).toThrow();
    }
  });
});

describe("totp/sudo", () => {
  it("folds a Persian TOTP code and needs a 64-hex temp token", () => {
    expect(staffTotpSchema.parse({ tempToken: HEX, code: "۱۲۳۴۵۶" })).toEqual({ tempToken: HEX, code: "123456" });
    expect(() => staffTotpSchema.parse({ tempToken: "a".repeat(10), code: "123456" })).toThrow();
    expect(() => staffTotpSchema.parse({ tempToken: HEX.toUpperCase(), code: "123456" })).toThrow();
    expect(() => staffTotpSchema.parse({ tempToken: HEX, code: "12345" })).toThrow();
    expect(() => staffTotpSchema.parse({ tempToken: HEX, code: "123456", remember: true })).toThrow();

    expect(staffSudoSchema.parse({ code: "۱۲۳۴۵۶" })).toEqual({ code: "123456" });
    expect(totpEnrolConfirmSchema.parse({ code: "123456" })).toEqual({ code: "123456" });
    expect(() => staffSudoSchema.parse({ code: "123456", secret: "JBSWY3DP" })).toThrow();
    expect(() => totpEnrolConfirmSchema.parse({})).toThrow();
  });
});

describe("invite/update", () => {
  it("invites with an email, a name and a role of ROLE_NAMES", () => {
    expect(staffInviteSchema.parse({ email: " New@Namilux.IR ", name: "زهرا", role: "content" })).toEqual({
      email: "new@namilux.ir",
      name: "زهرا",
      role: "content",
    });
    for (const role of ROLE_NAMES) {
      expect(staffInviteSchema.parse({ email: "a@b.ir", name: "زهرا", role }).role).toBe(role);
    }
    for (const bad of ["superuser", "Owner", "", null]) {
      expect(() => staffInviteSchema.parse({ email: "a@b.ir", name: "زهرا", role: bad }), JSON.stringify(bad)).toThrow();
    }
    expect(() => staffInviteSchema.parse({ email: "a@b.ir", name: "ز", role: "viewer" })).toThrow();
    expect(() => staffInviteSchema.parse({ email: "a@b.ir", name: "زهرا", role: "viewer", password: PASSWORD })).toThrow();

    expect(staffAcceptInviteSchema.parse({ token: HEX, password: PASSWORD })).toEqual({ token: HEX, password: PASSWORD });
    expect(() => staffAcceptInviteSchema.parse({ token: "abc", password: PASSWORD })).toThrow();
  });

  it("update needs at least one key and never accepts an id", () => {
    expect(staffUpdateSchema.parse({ role: "orders" })).toEqual({ role: "orders" });
    expect(staffUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(staffUpdateSchema.parse({ forceTotpReenrol: true })).toEqual({ forceTotpReenrol: true });
    expect(staffUpdateSchema.parse({ resetPassword: true })).toEqual({ resetPassword: true });
    expect(staffUpdateSchema.parse({ name: "زهرا" })).toEqual({ name: "زهرا" });
    expect(() => staffUpdateSchema.parse({})).toThrow();
    expect(() => staffUpdateSchema.parse({ id: ULID, role: "orders" })).toThrow();
    expect(() => staffUpdateSchema.parse({ role: "root" })).toThrow();
    expect(() => staffUpdateSchema.parse({ isActive: "false" })).toThrow();
    expect(() => staffUpdateSchema.parse({ permissions: ["staff.manage"] })).toThrow();
  });
});

describe("password change", () => {
  it("refuses the same value and keeps both secrets verbatim", () => {
    expect(passwordChangeSchema.parse({ current: PASSWORD, next: `${PASSWORD} 2` })).toEqual({
      current: PASSWORD,
      next: `${PASSWORD} 2`,
    });
    const same = passwordChangeSchema.safeParse({ current: PASSWORD, next: PASSWORD });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(["next"]);
    expect(() => passwordChangeSchema.parse({ current: PASSWORD, next: "short" })).toThrow();
    expect(() => passwordChangeSchema.parse({ next: PASSWORD })).toThrow();
    expect(() => passwordChangeSchema.parse({ current: PASSWORD, next: `${PASSWORD}2`, confirm: `${PASSWORD}2` })).toThrow();
  });

  it("session revoke and the staff id param take a ULID", () => {
    expect(staffSessionRevokeSchema.parse({ sessionId: ULID })).toEqual({ sessionId: ULID });
    expect(staffIdParamSchema.parse({ id: ULID })).toEqual({ id: ULID });
    expect(() => staffSessionRevokeSchema.parse({ sessionId: "1" })).toThrow();
    expect(() => staffIdParamSchema.parse({ id: ULID, role: "owner" })).toThrow();
  });
});
