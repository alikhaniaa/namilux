import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type Db,
  and,
  eq,
  gt,
  sql,
  staffRoles,
  staffSessions,
  staffUsers,
} from "@namilux/db";
import { STAFF_SESSION_COOKIE } from "../constants";
import type { RoleName } from "../authz/permissions";
import { isRoleName, permissionsForRole } from "../authz/permissions";
import type { Permission } from "../authz/permissions";
import { appError } from "../errors";
import { ulid } from "../ids";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { security } from "../security";
import type { Actor, StaffUser } from "../types";
import { hashPassword, isAcceptablePassword, PASSWORD_FA, verifyPassword } from "./password";
import { hashToken, newSessionToken } from "./sessions";
import { ipSlash24 } from "./quota";
import { passwordOnlyDemoEnabled } from "./demo-login";
import {
  TOTP_DRIFT_STEPS,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  otpauthUri,
  totpEncKeyFromHex,
  verifyTotp,
  verifyTotpStep,
} from "./totp";

export { STAFF_SESSION_COOKIE };
export const SUDO_COOKIE = "nl_sudo";
export const STAFF_IDLE_MS = 1_800_000;
export const STAFF_ABSOLUTE_MS = 43_200_000;
export const STAFF_LOCK_AFTER = 5;
export const STAFF_LOCK_MS = 900_000;
export const TEMP_TOKEN_TTL_MS = 300_000;
export const SUDO_TTL_MS = 300_000;
export const INVITE_TTL_MS = 86_400_000;
export const STAFF_LOGIN_FA = "ایمیل یا گذرواژه درست نیست";
const TEMP_EXPIRED_FA = "نشست ورود منقضی شده است؛ دوباره وارد شوید";
const TOTP_INVALID_FA = "کد تأیید درست نیست";
const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type TempTokenKind = "totp" | "invite";

/**
 * A valid-format scrypt hash the same cost (N=2^17) as a real one. Verified against when the email
 * is unknown so a missing user costs the same time as a wrong password.
 */
const DUMMY_PASSWORD_HASH = `scrypt$131072$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(32).toString("base64url")}`;

/**
 * Single-use guard: the step of the last TOTP code accepted for a staff member (admin is one
 * process). It records the step the CODE belongs to, never the wall-clock step it was checked in - 
 * the two differ whenever a code is read at the end of one window and submitted in the next, and
 * keying the guard on the clock made the step-up («تأیید دوباره») refuse codes login accepted:
 * a login and a step-up landing in the same 30 seconds, or two step-ups in a row, and the second
 * one was rejected as a replay however fresh its code was.
 */
const acceptedSteps = new Map<string, number>();

function pepper(): string {
  const p = process.env.SESSION_PEPPER;
  if (typeof p !== "string" || p === "") throw appError("INTERNAL", { details: "SESSION_PEPPER is not configured" });
  return p;
}

function totpKey(): Uint8Array {
  const hex = process.env.TOTP_ENC_KEY;
  if (typeof hex !== "string" || hex === "") throw appError("INTERNAL", { details: "TOTP_ENC_KEY is not configured" });
  try {
    return totpEncKeyFromHex(hex);
  } catch (err: unknown) {
    throw appError("INTERNAL", { details: `TOTP_ENC_KEY is malformed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

function b64uJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(s);
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// ── temp tokens (pre-TOTP + invite) ──────────────────────────────────────────────────────────
export function signTempToken(staffId: string, key: string, kind: TempTokenKind, now = new Date()): string {
  const payload = b64uJson({ s: staffId, t: now.getTime(), k: kind });
  const sig = createHmac("sha256", key).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function parseTempToken(
  token: string,
  key: string,
  kind: TempTokenKind,
  now = new Date(),
): { staffId: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  // Compare the hex strings themselves (not decoded bytes - Buffer.from("hex") silently drops a
  // trailing non-hex char, which would let `${token}x` pass). Length check guards timingSafeEqual.
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }
  const parsed = parseJsonObject(Buffer.from(payload, "base64url").toString("utf8"));
  if (parsed === null) return null;
  if (typeof parsed.s !== "string" || typeof parsed.t !== "number" || parsed.k !== kind) return null;
  const ttl = kind === "totp" ? TEMP_TOKEN_TTL_MS : INVITE_TTL_MS;
  if (now.getTime() - parsed.t > ttl) return null;
  return { staffId: parsed.s };
}

// ── sudo token ───────────────────────────────────────────────────────────────────────────────
export function signSudoToken(sessionId: string, until: Date, key: string): string {
  const payload = b64uJson({ sid: sessionId, u: until.getTime() });
  const sig = createHmac("sha256", key).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySudoToken(token: string, sessionId: string, key: string, now = new Date()): Date | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) {
    return null;
  }
  const parsed = parseJsonObject(Buffer.from(payload, "base64url").toString("utf8"));
  if (parsed === null) return null;
  if (parsed.sid !== sessionId || typeof parsed.u !== "number" || parsed.u <= now.getTime()) return null;
  return new Date(parsed.u);
}

// ── DB helpers ───────────────────────────────────────────────────────────────────────────────
type StaffRow = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  totpSecretEnc: string | null;
  totpEnabled: boolean;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  roleId: number;
};

async function loadStaffByEmail(db: Db, email: string): Promise<StaffRow | undefined> {
  const rows = await db
    .select({
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      passwordHash: staffUsers.passwordHash,
      totpSecretEnc: staffUsers.totpSecretEnc,
      totpEnabled: staffUsers.totpEnabled,
      isActive: staffUsers.isActive,
      failedAttempts: staffUsers.failedAttempts,
      lockedUntil: staffUsers.lockedUntil,
      roleId: staffUsers.roleId,
    })
    .from(staffUsers)
    .where(sql`lower(${staffUsers.email}) = ${email}`)
    .limit(1);
  return rows[0];
}

async function loadStaffById(db: Db, id: string): Promise<StaffRow | undefined> {
  const rows = await db
    .select({
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      passwordHash: staffUsers.passwordHash,
      totpSecretEnc: staffUsers.totpSecretEnc,
      totpEnabled: staffUsers.totpEnabled,
      isActive: staffUsers.isActive,
      failedAttempts: staffUsers.failedAttempts,
      lockedUntil: staffUsers.lockedUntil,
      roleId: staffUsers.roleId,
    })
    .from(staffUsers)
    .where(eq(staffUsers.id, id))
    .limit(1);
  return rows[0];
}

/** Shared failure counter for password and TOTP (the spec "5 failures → 15-min lock"). */
async function bumpFailure(db: Db, user: StaffRow, ip: string): Promise<void> {
  const attempts = user.failedAttempts + 1;
  if (attempts >= STAFF_LOCK_AFTER) {
    await db
      .update(staffUsers)
      .set({ failedAttempts: 0, lockedUntil: sql`now() + interval '15 minutes'` })
      .where(eq(staffUsers.id, user.id));
    await security.event(db, "staff.login.locked", { emailMasked: maskEmail(user.email) }, ip);
  } else {
    await db.update(staffUsers).set({ failedAttempts: attempts }).where(eq(staffUsers.id, user.id));
  }
}

// ── login / TOTP / session ───────────────────────────────────────────────────────────────────
export async function staffLogin(
  db: Db,
  i: { email: string; password: string; ip: string; ua: string },
): Promise<{ staffId: string; needsTotp: boolean; tempToken: string; token?: string }> {
  const email = i.email.trim().toLowerCase();
  const user = await loadStaffByEmail(db, email);
  const now = new Date();
  const locked = user?.lockedUntil != null && new Date(user.lockedUntil).getTime() > now.getTime();
  // Always run a verify (dummy hash when the user is missing) so timing does not leak existence.
  const pwOk = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, i.password);

  let reason: "missing" | "inactive" | "locked" | "password" | null = null;
  if (user === undefined) reason = "missing";
  else if (!user.isActive) reason = "inactive";
  else if (locked) reason = "locked";
  else if (!pwOk) reason = "password";

  if (reason !== null) {
    if (user !== undefined && reason === "password") await bumpFailure(db, user, i.ip);
    await security.event(db, "staff.login.failed", { emailMasked: maskEmail(email), reason }, i.ip);
    throw appError("UNAUTHORIZED", { httpStatus: 401, fa: STAFF_LOGIN_FA });
  }
  // reason === null implies a defined, active, unlocked user with the right password.
  if (user === undefined) throw appError("INTERNAL");

  // Owner-authorized test-server exception. The normal password, active-user and lockout
  // checks above remain mandatory. Session tokens stay server-side and are sent only as cookies.
  if (passwordOnlyDemoEnabled(process.env)) {
    const { token } = await openSession(db, user, i.ip, i.ua);
    return { staffId: user.id, needsTotp: false, tempToken: "", token };
  }

  // the spec: the failure counter is shared by the password and TOTP steps - it resets only when a
  // session opens (openSession), so 3 wrong passwords + 2 wrong codes still lock the account.
  return {
    staffId: user.id,
    needsTotp: user.totpEnabled,
    tempToken: signTempToken(user.id, pepper(), "totp", now),
  };
}

/** Verify a TOTP code against the stored secret with lockout + replay guard. Throws on failure. */
async function verifyStaffTotp(
  db: Db,
  user: StaffRow,
  code: string,
  ip: string,
  failReason: "totp" | "sudo",
): Promise<void> {
  if (user.totpSecretEnc === null) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const secret = decryptTotpSecret(user.totpSecretEnc, totpKey());
  // Both paths - the login step and the step-up - allow the same ±1 step of drift.
  const matched = verifyTotpStep(secret, code, TOTP_DRIFT_STEPS);
  const replay = matched !== null && acceptedSteps.get(user.id) === matched;
  if (matched === null || replay) {
    await bumpFailure(db, user, ip);
    if (failReason === "sudo") {
      await security.event(db, "staff.sudo", { emailMasked: maskEmail(user.email), ok: false }, ip);
    } else {
      await security.event(db, "staff.login.failed", { emailMasked: maskEmail(user.email), reason: "totp" }, ip);
    }
    throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TOTP_INVALID_FA });
  }
  acceptedSteps.set(user.id, matched);
}

/** Insert one staff session row and clear the failure counter. No login side effects. */
async function insertSession(db: Db, user: StaffRow, ip: string, ua: string): Promise<{ token: string; sessionId: string }> {
  const token = newSessionToken();
  const sessionId = ulid();
  await db.insert(staffSessions).values({
    id: sessionId,
    staffId: user.id,
    tokenHash: hashToken(token, pepper()),
    lastSeenAt: new Date(),
    idleExpiresAt: sql`now() + interval '30 minutes'`,
    absoluteExpiresAt: sql`now() + interval '12 hours'`,
    // DECISION (M8 browser check): `ip` is an inet column; an unknown client address (no proxy header in dev) is stored as NULL, never "".
    ip: ip === "" ? null : ip,
    ua: ua.slice(0, 512),
  });
  await db
    .update(staffUsers)
    .set({ failedAttempts: 0, lastLoginAt: sql`now()` })
    .where(eq(staffUsers.id, user.id));
  return { token, sessionId };
}

/** Create a staff session row + login side effects (new-IP alert). */
async function openSession(db: Db, user: StaffRow, ip: string, ua: string): Promise<{ token: string }> {
  const { token, sessionId } = await insertSession(db, user, ip, ua);

  // New /24 among the last 20 sessions → alert (the spec admin login from new IP).
  // "seen before" = any earlier session of this user from the same /24 (the row just inserted is excluded
  // by id, not by prefix - deleting the prefix made every login look new).
  const recent = await db
    .select({ ip: staffSessions.ip })
    .from(staffSessions)
    .where(and(eq(staffSessions.staffId, user.id), sql`${staffSessions.id} <> ${sessionId}`))
    .orderBy(sql`${staffSessions.createdAt} desc`)
    .limit(20);
  const seen = new Set(recent.map((r) => ipSlash24(String(r.ip ?? "").replace(/\/32$/, ""))));
  const newIp = !seen.has(ipSlash24(ip));
  if (newIp) await security.event(db, "staff.login.new_ip", { emailMasked: maskEmail(user.email) }, ip);
  await jobs.enqueue(db, "telegram.notify", {
    kind: "admin.login",
    staffName: user.name,
    ipSlash24: ipSlash24(ip),
    newIp,
  });
  return { token };
}

export async function staffVerifyTotp(
  db: Db,
  i: { tempToken: string; code: string; ip: string; ua: string },
): Promise<{ token: string }> {
  const parsed = parseTempToken(i.tempToken, pepper(), "totp");
  if (parsed === null) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const user = await loadStaffById(db, parsed.staffId);
  const locked = user?.lockedUntil != null && new Date(user.lockedUntil).getTime() > Date.now();
  if (user === undefined || !user.isActive || locked || !user.totpEnabled) {
    throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  }
  await verifyStaffTotp(db, user, i.code, i.ip, "totp");
  return openSession(db, user, i.ip, i.ua);
}

export async function staffResolve(db: Db, token: string | undefined, ip: string): Promise<StaffUser | null> {
  if (token === undefined || !SESSION_TOKEN_RE.test(token)) return null;
  const tokenHash = hashToken(token, pepper());
  const rows = await db
    .select({
      sessionId: staffSessions.id,
      sessionIp: staffSessions.ip,
      lastSeenAt: staffSessions.lastSeenAt,
      absoluteExpiresAt: staffSessions.absoluteExpiresAt,
      staffId: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      isActive: staffUsers.isActive,
      totpEnabled: staffUsers.totpEnabled,
      mustChangePassword: staffUsers.mustChangePassword,
      roleName: staffRoles.name,
      rolePermissions: staffRoles.permissions,
    })
    .from(staffSessions)
    .innerJoin(staffUsers, eq(staffSessions.staffId, staffUsers.id))
    .innerJoin(staffRoles, eq(staffUsers.roleId, staffRoles.id))
    .where(
      and(
        eq(staffSessions.tokenHash, tokenHash),
        gt(staffSessions.idleExpiresAt, sql`now()`),
        gt(staffSessions.absoluteExpiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (!row.isActive) return null;

  if (ipSlash24(ip) !== ipSlash24(String(row.sessionIp ?? ""))) {
    await db
      .update(staffSessions)
      .set({ idleExpiresAt: sql`now()`, absoluteExpiresAt: sql`now()` })
      .where(eq(staffSessions.id, row.sessionId));
    await security.event(db, "staff.login.new_ip", { emailMasked: maskEmail(row.email), reason: "ip_mismatch" }, ip);
    return null;
  }

  const lastSeen = row.lastSeenAt instanceof Date ? row.lastSeenAt : new Date(row.lastSeenAt);
  if (Date.now() - lastSeen.getTime() >= 60_000) {
    await db
      .update(staffSessions)
      .set({
        lastSeenAt: sql`now()`,
        idleExpiresAt: sql`least(now() + interval '30 minutes', ${staffSessions.absoluteExpiresAt})`,
      })
      .where(eq(staffSessions.id, row.sessionId));
  }

  const role = row.roleName as RoleName;
  // The CODE's matrix is authoritative for every role the code declares: `staff_roles.permissions`
  // is a mirror written by the seed and by migration 0004, and a row left behind by an older
  // release must never be able to narrow the owner's access (or widen anyone else's) after a
  // deploy that adds a permission. The stored list is used only for a role name the code does not
  // know - a hand-made row - and `permissionsForRole` returns [] for those unless one is present.
  const custom = row.rolePermissions as Permission[] | null;
  const permissions: Permission[] = isRoleName(role)
    ? [...permissionsForRole(role)]
    : custom !== null && custom.length > 0
      ? custom
      : [];
  return {
    id: row.staffId,
    email: row.email,
    name: row.name,
    role,
    permissions,
    isActive: row.isActive,
    totpEnabled: row.totpEnabled,
    sudoUntil: null,
    sessionId: row.sessionId,
    mustChangePassword: row.mustChangePassword,
  };
}

export async function staffSudo(db: Db, staffId: string, totpCode: string): Promise<{ until: Date }> {
  const user = await loadStaffById(db, staffId);
  if (user === undefined || !user.isActive) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  await verifyStaffTotp(db, user, totpCode, "", "sudo");
  await security.event(db, "staff.sudo", { emailMasked: maskEmail(user.email), ok: true });
  return { until: new Date(Date.now() + SUDO_TTL_MS) };
}

export async function staffLogout(db: Db, token: string): Promise<void> {
  if (!SESSION_TOKEN_RE.test(token)) return;
  await db
    .update(staffSessions)
    .set({ idleExpiresAt: sql`now()`, absoluteExpiresAt: sql`now()` })
    .where(eq(staffSessions.tokenHash, hashToken(token, pepper())));
}

export async function staffRevokeAll(db: Db, staffId: string): Promise<void> {
  await db
    .update(staffSessions)
    .set({ idleExpiresAt: sql`now()`, absoluteExpiresAt: sql`now()` })
    .where(eq(staffSessions.staffId, staffId));
}

/**
 * Change a staff member's own password. Every session the account holds is ended - a password
 * change has to log the other devices out - and then, when `reissue` is given, ONE fresh session is
 * opened for the browser doing the change and its token returned. Without that the forced
 * first-login change ended with the person holding a cookie for a session that no longer existed,
 * so the panel bounced them to /login the moment they arrived (7 Sep 2026 walkthrough).
 */
export async function staffChangePassword(
  db: Db,
  staffId: string,
  i: { current: string; next: string; breached: ReadonlySet<string>; reissue?: { ip: string; ua: string } },
  actor: Actor,
): Promise<{ token: string | null }> {
  const acceptable = isAcceptablePassword(i.next, i.breached);
  if (!acceptable.ok) throw appError("VALIDATION", { httpStatus: 400, fa: PASSWORD_FA[acceptable.reason] });
  const user = await loadStaffById(db, staffId);
  if (user === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  if (!(await verifyPassword(user.passwordHash, i.current))) {
    throw appError("UNAUTHORIZED", { httpStatus: 401, fa: "گذرواژهٔ فعلی درست نیست" });
  }
  await db
    .update(staffUsers)
    .set({ passwordHash: await hashPassword(i.next), mustChangePassword: false })
    .where(eq(staffUsers.id, staffId));
  await staffRevokeAll(db, staffId);
  await audit.log(db, actor, "staff.password.change", "staff_users", staffId);
  if (i.reissue === undefined) return { token: null };
  // A quiet session: this is not a login, so it raises no new-IP alert and no Telegram notice.
  const { token } = await insertSession(db, user, i.reissue.ip, i.reissue.ua);
  return { token };
}

export async function staffTotpEnrolStart(
  db: Db,
  tempToken: string,
): Promise<{ secretBase32: string; otpauth: string }> {
  const parsed = parseTempToken(tempToken, pepper(), "totp");
  if (parsed === null) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const user = await loadStaffById(db, parsed.staffId);
  if (user === undefined || !user.isActive) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  if (user.totpEnabled) throw appError("CONFLICT", { httpStatus: 409, fa: "تأیید دومرحله‌ای قبلاً فعال شده است" });
  const secret = generateTotpSecret();
  await db
    .update(staffUsers)
    .set({ totpSecretEnc: encryptTotpSecret(secret, totpKey()), totpEnabled: false })
    .where(eq(staffUsers.id, user.id));
  return { secretBase32: base32Encode(secret), otpauth: otpauthUri(secret, user.email) };
}

export async function staffTotpEnrolConfirm(
  db: Db,
  i: { tempToken: string; code: string; ip: string; ua: string },
): Promise<{ token: string }> {
  const parsed = parseTempToken(i.tempToken, pepper(), "totp");
  if (parsed === null) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const user = await loadStaffById(db, parsed.staffId);
  if (user === undefined || !user.isActive || user.totpSecretEnc === null) {
    throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  }
  const secret = decryptTotpSecret(user.totpSecretEnc, totpKey());
  if (!verifyTotp(secret, i.code, TOTP_DRIFT_STEPS)) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TOTP_INVALID_FA });
  await db.update(staffUsers).set({ totpEnabled: true }).where(eq(staffUsers.id, user.id));
  await audit.log(db, { type: "staff", id: user.id, ip: i.ip }, "staff.totp.enrol", "staff_users", user.id);
  return openSession(db, user, i.ip, i.ua);
}

export async function staffInvite(
  db: Db,
  i: { email: string; name: string; role: RoleName },
  actor: Actor,
): Promise<{ inviteToken: string; expiresAt: Date }> {
  const email = i.email.trim().toLowerCase();
  const existing = await loadStaffByEmail(db, email);
  if (existing !== undefined) throw appError("CONFLICT", { httpStatus: 409, fa: "این ایمیل قبلاً ثبت شده است" });
  const roleRows = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, i.role)).limit(1);
  const roleRow = roleRows[0];
  if (roleRow === undefined) throw appError("VALIDATION", { httpStatus: 400, fa: "نقش نامعتبر است" });
  const id = ulid();
  await db.insert(staffUsers).values({
    id,
    email,
    name: i.name,
    passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
    roleId: roleRow.id,
    isActive: false,
    totpEnabled: false,
    mustChangePassword: true,
  });
  const inviteToken = signTempToken(id, pepper(), "invite");
  await audit.log(db, actor, "staff.invite", "staff_users", id, undefined, { email, role: i.role });
  return { inviteToken, expiresAt: new Date(Date.now() + INVITE_TTL_MS) };
}

export async function staffAcceptInvite(
  db: Db,
  i: { inviteToken: string; password: string; breached: ReadonlySet<string> },
): Promise<{ staffId: string }> {
  const parsed = parseTempToken(i.inviteToken, pepper(), "invite");
  if (parsed === null) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const user = await loadStaffById(db, parsed.staffId);
  if (user === undefined || user.isActive) throw appError("UNAUTHORIZED", { httpStatus: 401, fa: TEMP_EXPIRED_FA });
  const acceptable = isAcceptablePassword(i.password, i.breached);
  if (!acceptable.ok) throw appError("VALIDATION", { httpStatus: 400, fa: PASSWORD_FA[acceptable.reason] });
  await db
    .update(staffUsers)
    .set({ passwordHash: await hashPassword(i.password), isActive: true, mustChangePassword: false })
    .where(eq(staffUsers.id, user.id));
  return { staffId: user.id };
}
