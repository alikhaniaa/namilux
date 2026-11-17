import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, jobs as jobsTable, securityEvents, sql, staffRoles, staffSessions, staffUsers } from "@namilux/db";
import { ulid } from "../../ids";
import { hashPassword, PASSWORD_FA } from "../password";
import {
  parseTempToken,
  signSudoToken,
  signTempToken,
  staffAcceptInvite,
  staffChangePassword,
  staffInvite,
  staffLogin,
  staffResolve,
  staffSudo,
  staffTotpEnrolConfirm,
  staffTotpEnrolStart,
  staffVerifyTotp,
  verifySudoToken,
} from "../staff";
import { TOTP_STEP_SEC, base32Decode, encryptTotpSecret, generateTotpSecret, totp, totpEncKeyFromHex } from "../totp";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);
const NOW = new Date("2026-08-28T10:00:00Z");
const after = (ms: number): Date => new Date(NOW.getTime() + ms);

describe("auth/staff - pure", () => {
  it("signTempToken/parseTempToken round-trip for kind totp within 5 min", () => {
    const token = signTempToken("stf_1", KEY, "totp", NOW);
    expect(parseTempToken(token, KEY, "totp", after(4 * 60_000))).toEqual({ staffId: "stf_1" });
    expect(parseTempToken(token, KEY, "totp", NOW)).toEqual({ staffId: "stf_1" });
  });

  it("parseTempToken returns null after 5 min, with another pepper, when tampered, and when the kind differs", () => {
    const token = signTempToken("stf_1", KEY, "totp", NOW);
    expect(parseTempToken(token, KEY, "totp", after(5 * 60_000 + 1))).toBeNull();
    expect(parseTempToken(token, OTHER, "totp", NOW)).toBeNull();
    expect(parseTempToken(`${token}x`, KEY, "totp", NOW)).toBeNull();
    expect(parseTempToken(token, KEY, "invite", NOW)).toBeNull();
  });

  it("invite tokens live 24 h and expire after", () => {
    const token = signTempToken("stf_1", KEY, "invite", NOW);
    expect(parseTempToken(token, KEY, "invite", after(23 * 3_600_000))).toEqual({ staffId: "stf_1" });
    expect(parseTempToken(token, KEY, "invite", after(24 * 3_600_000 + 1))).toBeNull();
  });

  it("signSudoToken/verifySudoToken round-trip; another sessionId → null; expired → null; tampered → null", () => {
    const until = after(5 * 60_000);
    const token = signSudoToken("sess_1", until, KEY);
    expect(verifySudoToken(token, "sess_1", KEY, NOW)?.getTime()).toBe(until.getTime());
    expect(verifySudoToken(token, "sess_2", KEY, NOW)).toBeNull();
    expect(verifySudoToken(token, "sess_1", KEY, after(5 * 60_000 + 1))).toBeNull();
    expect(verifySudoToken(`${token}x`, "sess_1", KEY, NOW)).toBeNull();
    expect(verifySudoToken(token, "sess_1", OTHER, NOW)).toBeNull();
  });
});

const PASSWORD = "CorrectHorseBattery9x";
const ENC_KEY = "c".repeat(64);
const IP = "10.0.0.5";
const UA = "vitest";

describe.skipIf(!hasTestDb())("auth/staff — integration", () => {
  let handle: TestDb;
  let roleId: number;
  const savedEnv = { pepper: process.env.SESSION_PEPPER, key: process.env.TOTP_ENC_KEY };

  beforeAll(async () => {
    process.env.SESSION_PEPPER = "d".repeat(64);
    process.env.TOTP_ENC_KEY = ENC_KEY;
    handle = await createTestDb();
    await truncateAll(handle.db);
  });
  beforeEach(async () => {
    const rows = await handle.db.insert(staffRoles).values({ name: "owner", permissions: [] }).returning({ id: staffRoles.id });
    roleId = rows[0]?.id ?? 0;
  });
  afterEach(async () => {
    vi.useRealTimers();
    process.env.TOTP_ENC_KEY = ENC_KEY;
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    process.env.SESSION_PEPPER = savedEnv.pepper;
    process.env.TOTP_ENC_KEY = savedEnv.key;
    await handle.close();
  });

  type Staff = { id: string; email: string; secret: Uint8Array };
  async function makeStaff(over: { totp?: boolean; active?: boolean } = {}): Promise<Staff> {
    const secret = generateTotpSecret();
    const id = ulid();
    const email = `s-${id.slice(-8).toLowerCase()}@namilux.test`;
    await handle.db.insert(staffUsers).values({
      id,
      email,
      name: "کارمند آزمون",
      passwordHash: await hashPassword(PASSWORD),
      roleId,
      isActive: over.active ?? true,
      totpEnabled: over.totp ?? true,
      totpSecretEnc: over.totp === false ? null : encryptTotpSecret(secret, totpEncKeyFromHex(ENC_KEY)),
      mustChangePassword: false,
    });
    return { id, email, secret };
  }

  async function login(s: Staff, ip = IP): Promise<string> {
    const step1 = await staffLogin(handle.db, { email: s.email, password: PASSWORD, ip, ua: UA });
    expect(step1.needsTotp).toBe(true);
    const { token } = await staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code: totp(s.secret), ip, ua: UA });
    return token;
  }

  async function failedAttempts(id: string): Promise<number> {
    return (await handle.db.select({ n: staffUsers.failedAttempts }).from(staffUsers).where(eq(staffUsers.id, id)))[0]?.n ?? -1;
  }

  async function eventsJson(): Promise<string> {
    return JSON.stringify(await handle.db.select().from(securityEvents));
  }

  it("happy path: staffLogin → needsTotp true → staffVerifyTotp → staffResolve returns the role's permissions", async () => {
    const s = await makeStaff();
    const token = await login(s);
    const user = await staffResolve(handle.db, token, IP);
    expect(user?.id).toBe(s.id);
    expect(user?.email).toBe(s.email);
    expect(user?.role).toBe("owner");
    expect(Array.isArray(user?.permissions)).toBe(true);
    expect(user?.permissions.length).toBeGreaterThan(0);
    expect(user?.totpEnabled).toBe(true);
    expect(await failedAttempts(s.id)).toBe(0);
  });

  it("unknown email and wrong password produce the identical message and both run the dummy hash verify", async () => {
    const s = await makeStaff();
    const unknown = await staffLogin(handle.db, { email: "nobody@namilux.test", password: PASSWORD, ip: IP, ua: UA }).catch((e: unknown) => e as Error);
    const wrong = await staffLogin(handle.db, { email: s.email, password: "WrongPassword-123456", ip: IP, ua: UA }).catch((e: unknown) => e as Error);
    expect(unknown).toBeInstanceOf(Error);
    expect(wrong).toBeInstanceOf(Error);
    expect((unknown as Error).message).toBe((wrong as Error).message);
    expect(await failedAttempts(s.id)).toBe(1);
    expect(await eventsJson()).toContain("staff.login.failed");
  });

  it("5 wrong passwords lock the account: the 6th correct attempt fails; after 15 min it succeeds and failed_attempts is 0", async () => {
    const s = await makeStaff();
    for (let i = 0; i < 5; i += 1) {
      await expect(staffLogin(handle.db, { email: s.email, password: "WrongPassword-123456", ip: IP, ua: UA })).rejects.toThrow();
    }
    await expect(staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA })).rejects.toThrow();
    expect(await eventsJson()).toContain("staff.login.locked");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1_000);
    const token = await login(s);
    expect(await staffResolve(handle.db, token, IP)).not.toBeNull();
    expect(await failedAttempts(s.id)).toBe(0);
  });

  it("3 wrong passwords + 2 wrong TOTP codes lock the account (shared counter)", async () => {
    const s = await makeStaff();
    for (let i = 0; i < 3; i += 1) {
      await expect(staffLogin(handle.db, { email: s.email, password: "WrongPassword-123456", ip: IP, ua: UA })).rejects.toThrow();
    }
    const step1 = await staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA });
    expect(await failedAttempts(s.id)).toBe(3);
    await expect(staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code: "000000", ip: IP, ua: UA })).rejects.toThrow();
    await expect(staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code: "111111", ip: IP, ua: UA })).rejects.toThrow();
    // the 5th failure locks: the counter resets to 0 and locked_until is set (bumpFailure)
    const row = (await handle.db.select({ n: staffUsers.failedAttempts, until: staffUsers.lockedUntil }).from(staffUsers).where(eq(staffUsers.id, s.id)))[0];
    expect(row?.n).toBe(0);
    expect(row?.until).not.toBeNull();
    expect(await eventsJson()).toContain("staff.login.locked");
    await expect(staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code: totp(s.secret), ip: IP, ua: UA })).rejects.toThrow();
  });

  it("a TOTP code submitted twice within one step is rejected the second time", async () => {
    const s = await makeStaff();
    const step1 = await staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA });
    const code = totp(s.secret);
    await expect(staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code, ip: IP, ua: UA })).resolves.toHaveProperty("token");
    await expect(staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code, ip: IP, ua: UA })).rejects.toThrow();
  });

  it("staffResolve from a different /24 returns null, revokes the session and writes staff.session.ip_mismatch", async () => {
    const s = await makeStaff();
    const token = await login(s, "10.0.0.5");
    expect(await staffResolve(handle.db, token, "10.0.0.77")).not.toBeNull(); // same /24
    expect(await staffResolve(handle.db, token, "10.0.1.5")).toBeNull();
    expect(await eventsJson()).toContain("ip_mismatch");
    expect(await staffResolve(handle.db, token, "10.0.0.5")).toBeNull(); // revoked
  });

  it("idle: last_seen_at 31 min ago → null; absolute: created 12 h 1 min ago → null even if seen 1 min ago", async () => {
    const s = await makeStaff();
    const idle = await login(s);
    await handle.db.update(staffSessions).set({ lastSeenAt: sql`now() - interval '31 minutes'`, idleExpiresAt: sql`now() - interval '1 minute'` }).where(eq(staffSessions.staffId, s.id));
    expect(await staffResolve(handle.db, idle, IP)).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000); // a fresh TOTP step for the second login
    const absolute = await login(s);
    vi.useRealTimers();
    await handle.db
      .update(staffSessions)
      .set({ lastSeenAt: sql`now() - interval '1 minute'`, idleExpiresAt: sql`now() + interval '29 minutes'`, absoluteExpiresAt: sql`now() - interval '1 minute'` })
      .where(eq(staffSessions.idleExpiresAt, sql`(select max(idle_expires_at) from staff_sessions)`));
    expect(await staffResolve(handle.db, absolute, IP)).toBeNull();
  });

  it("an inactive user with a live session resolves to null", async () => {
    const s = await makeStaff();
    const token = await login(s);
    expect(await staffResolve(handle.db, token, IP)).not.toBeNull();
    await handle.db.update(staffUsers).set({ isActive: false }).where(eq(staffUsers.id, s.id));
    expect(await staffResolve(handle.db, token, IP)).toBeNull();
    await expect(staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA })).rejects.toThrow();
  });

  it("staffSudo with the correct code returns until ≈ now + 5 min and writes staff.sudo.ok", async () => {
    const s = await makeStaff();
    await login(s);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000); // the login consumed the current step
    await expect(staffSudo(handle.db, s.id, "000000")).rejects.toThrow();
    const { until } = await staffSudo(handle.db, s.id, totp(s.secret));
    expect(Math.abs(until.getTime() - (Date.now() + 5 * 60_000))).toBeLessThan(2_000);
    vi.useRealTimers();
    const events = await eventsJson();
    expect(events).toContain("staff.sudo");
    expect(events).toContain('"ok":true');
  });

  // 7 Sep 2026: the step-up refused codes the login step accepted. The verifier always allowed ±1
  // step; what did not was the single-use guard, which keyed on the wall clock, so any step-up that
  // landed in the same 30 seconds as an earlier accepted code was thrown out as a replay.
  it("staffSudo accepts a code from either neighbouring step, and a step-up in the login's own window", async () => {
    const s = await makeStaff();
    await login(s); // consumes the code of the current step
    const step = TOTP_STEP_SEC * 1000;
    // Same wall-clock window as the login, a different code: this is the case that used to 401.
    await expect(staffSudo(handle.db, s.id, totp(s.secret, Date.now() + step))).resolves.toHaveProperty("until");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * step);
    // A code read one step ago, and one from the step about to start, are both in tolerance.
    await expect(staffSudo(handle.db, s.id, totp(s.secret, Date.now() - step))).resolves.toHaveProperty("until");
    await expect(staffSudo(handle.db, s.id, totp(s.secret, Date.now() + step))).resolves.toHaveProperty("until");
    // Two steps out is not, and one code is still good exactly once.
    await expect(staffSudo(handle.db, s.id, totp(s.secret, Date.now() - 2 * step))).rejects.toThrow();
    const code = totp(s.secret);
    await expect(staffSudo(handle.db, s.id, code)).resolves.toHaveProperty("until");
    await expect(staffSudo(handle.db, s.id, code)).rejects.toThrow();
    vi.useRealTimers();
  });

  // The forced first-login change used to end with a cookie for a session that no longer existed.
  it("staffChangePassword with reissue hands back a working session while the old one dies", async () => {
    const s = await makeStaff();
    const old = await login(s);
    const { token } = await staffChangePassword(
      handle.db,
      s.id,
      { current: PASSWORD, next: "Tr0ub4dor&3-horse-staple", breached: new Set(), reissue: { ip: IP, ua: UA } },
      { type: "staff", id: s.id },
    );
    expect(token).not.toBeNull();
    expect(await staffResolve(handle.db, old, IP)).toBeNull();
    expect((await staffResolve(handle.db, token ?? "", IP))?.id).toBe(s.id);
    expect((await staffResolve(handle.db, token ?? "", IP))?.mustChangePassword).toBe(false);
  });

  it("staffChangePassword rejects a breached password with PASSWORD_FA.breached and on success revokes every session", async () => {
    const s = await makeStaff();
    const token = await login(s);
    const actor = { type: "staff" as const, id: s.id };
    await expect(
      staffChangePassword(handle.db, s.id, { current: PASSWORD, next: "Password-123456789", breached: new Set(["password-123456789"]) }, actor), // breach lists are lower-cased
    ).rejects.toThrow(PASSWORD_FA.breached);
    await expect(staffChangePassword(handle.db, s.id, { current: "not-the-current-one", next: "Tr0ub4dor&3-horse-staple", breached: new Set() }, actor)).rejects.toThrow();
    expect(await staffChangePassword(handle.db, s.id, { current: PASSWORD, next: "Tr0ub4dor&3-horse-staple", breached: new Set() }, actor)).toEqual({ token: null });
    expect(await staffResolve(handle.db, token, IP)).toBeNull();
    await expect(staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA })).rejects.toThrow();
    await expect(staffLogin(handle.db, { email: s.email, password: "Tr0ub4dor&3-horse-staple", ip: IP, ua: UA })).resolves.toHaveProperty("tempToken");
  });

  it("enrolment: start twice yields two secrets; confirm with the first secret's code fails; totp_enabled stays false until confirmed", async () => {
    const s = await makeStaff({ totp: false });
    const step1 = await staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA });
    expect(step1.needsTotp).toBe(false);
    const first = await staffTotpEnrolStart(handle.db, step1.tempToken);
    const second = await staffTotpEnrolStart(handle.db, step1.tempToken);
    expect(first.secretBase32).not.toBe(second.secretBase32);
    expect(second.otpauth).toContain("otpauth://totp/");
    await expect(staffTotpEnrolConfirm(handle.db, { tempToken: step1.tempToken, code: totp(base32Decode(first.secretBase32)), ip: IP, ua: UA })).rejects.toThrow();
    expect((await handle.db.select({ e: staffUsers.totpEnabled }).from(staffUsers).where(eq(staffUsers.id, s.id)))[0]?.e).toBe(false);
    const { token } = await staffTotpEnrolConfirm(handle.db, { tempToken: step1.tempToken, code: totp(base32Decode(second.secretBase32)), ip: IP, ua: UA });
    expect((await handle.db.select({ e: staffUsers.totpEnabled }).from(staffUsers).where(eq(staffUsers.id, s.id)))[0]?.e).toBe(true);
    expect((await staffResolve(handle.db, token, IP))?.totpEnabled).toBe(true);
    await expect(staffTotpEnrolStart(handle.db, step1.tempToken)).rejects.toThrow(); // already enrolled
  });

  it("invite: accepting after 24 h fails; accepting twice fails the second time; accepted user needs enrolment at first login", async () => {
    const owner = await makeStaff();
    const actor = { type: "staff" as const, id: owner.id };
    const late = await staffInvite(handle.db, { email: "late@namilux.test", name: "دیرآمده", role: "owner" }, actor);
    expect(late.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 3_600_000 + 1_000);
    await expect(staffAcceptInvite(handle.db, { inviteToken: late.inviteToken, password: "Tr0ub4dor&3-horse-staple", breached: new Set() })).rejects.toThrow();
    vi.useRealTimers();
    const fresh = await staffInvite(handle.db, { email: "new@namilux.test", name: "تازه‌وارد", role: "owner" }, actor);
    await expect(staffInvite(handle.db, { email: "new@namilux.test", name: "x", role: "owner" }, actor)).rejects.toThrow(); // email taken
    const accepted = await staffAcceptInvite(handle.db, { inviteToken: fresh.inviteToken, password: "Tr0ub4dor&3-horse-staple", breached: new Set() });
    await expect(staffAcceptInvite(handle.db, { inviteToken: fresh.inviteToken, password: "Tr0ub4dor&3-horse-staple", breached: new Set() })).rejects.toThrow();
    const step1 = await staffLogin(handle.db, { email: "new@namilux.test", password: "Tr0ub4dor&3-horse-staple", ip: IP, ua: UA });
    expect(step1.staffId).toBe(accepted.staffId);
    expect(step1.needsTotp).toBe(false); // enrolment comes first
  });

  it("malformed TOTP_ENC_KEY makes staffVerifyTotp throw INTERNAL", async () => {
    const s = await makeStaff();
    const step1 = await staffLogin(handle.db, { email: s.email, password: PASSWORD, ip: IP, ua: UA });
    process.env.TOTP_ENC_KEY = "zz";
    const err: unknown = await staffVerifyTotp(handle.db, { tempToken: step1.tempToken, code: totp(s.secret), ip: IP, ua: UA }).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("INTERNAL");
  });

  it("staffVerifyTotp enqueues a telegram.notify admin.login job with newIp true for an unseen /24", async () => {
    const s = await makeStaff();
    await login(s, "10.0.0.5");
    const jobs = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["kind"] === "admin.login");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payloadJson["newIp"]).toBe(true);
    expect(jobs[0]?.payloadJson["ipSlash24"]).toBe("10.0.0.0/24");
    expect(await eventsJson()).toContain("staff.login.new_ip");
    // a second login from the same /24 is not "new"
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 31_000);
    await login(s, "10.0.0.9");
    vi.useRealTimers();
    const again = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["kind"] === "admin.login");
    expect(again).toHaveLength(2);
    expect(again.some((j) => j.payloadJson["newIp"] === false)).toBe(true);
  });
});
