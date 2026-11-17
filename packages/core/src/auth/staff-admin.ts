import { type Db, and, desc, eq, gt, sql, staffRoles, staffSessions, staffUsers } from "@namilux/db";
import { audit } from "../audit";
import { ROLE_PERMISSIONS } from "../authz/permissions";
import type { RoleName } from "../authz/permissions";
import { appError } from "../errors";
import { ulid } from "../ids";
import type { Actor } from "../types";
import { PASSWORD_FA, generateStaffPassword, hashPassword, isAcceptablePassword } from "./password";

/** No breach list is loaded in this process; the shape `isAcceptablePassword` expects. */
const EMPTY_BREACHED: ReadonlySet<string> = new Set();
const SAME_AS_IDENTITY_FA = "گذرواژه نباید همان نام کاربری یا نام کارمند باشد";

export type StaffRow = {
  id: string;
  email: string;
  name: string;
  role: RoleName;
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  createdAt: string;
};

export type StaffSessionRow = {
  id: string;
  staffId: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  ip: string | null;
  ua: string | null;
  current: boolean;
};

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export async function listStaff(db: Db): Promise<StaffRow[]> {
  const rows = await db
    .select({ u: staffUsers, role: staffRoles.name })
    .from(staffUsers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffUsers.roleId))
    .orderBy(desc(staffUsers.isActive), staffUsers.createdAt);
  return rows.map(({ u, role }) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: role as RoleName,
    isActive: u.isActive,
    totpEnabled: u.totpEnabled,
    lastLoginAt: iso(u.lastLoginAt),
    lockedUntil: iso(u.lockedUntil),
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt.toISOString(),
  }));
}

export async function listStaffSessions(db: Db, staffId: string, currentSessionId?: string): Promise<StaffSessionRow[]> {
  const now = new Date();
  const rows = await db
    .select()
    .from(staffSessions)
    .where(and(eq(staffSessions.staffId, staffId), gt(staffSessions.absoluteExpiresAt, now), gt(staffSessions.idleExpiresAt, now)))
    .orderBy(desc(staffSessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    staffId: s.staffId,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    idleExpiresAt: s.idleExpiresAt.toISOString(),
    absoluteExpiresAt: s.absoluteExpiresAt.toISOString(),
    ip: s.ip,
    ua: s.ua,
    current: s.id === currentSessionId,
  }));
}

export async function revokeStaffSession(db: Db, sessionId: string, actor: Actor): Promise<void> {
  const rows = await db.select({ staffId: staffSessions.staffId }).from(staffSessions).where(eq(staffSessions.id, sessionId)).limit(1);
  if (rows[0] === undefined) throw appError("NOT_FOUND", { fa: "نشست پیدا نشد" });
  // staff_sessions has no revoked_at: a revoked session is a deleted row, like staffLogout.
  await db.delete(staffSessions).where(eq(staffSessions.id, sessionId));
  await audit.log(db, actor, "staff.session.revoke", "staff_sessions", sessionId, null, { staffId: rows[0].staffId });
}

/**
 * The role row `staff_users.role_id` points at. Created on demand from the code's own matrix so a
 * database migrated before a role existed (an `admin` row on a box seeded at launch, say) still
 * takes the assignment instead of failing with «نقش نامعتبر است».
 */
async function roleIdFor(db: Db, role: RoleName): Promise<number> {
  const found = (await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, role)).limit(1))[0];
  if (found !== undefined) return found.id;
  if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) throw appError("VALIDATION", { fa: "نقش نامعتبر است" });
  await db
    .insert(staffRoles)
    .values({ name: role, permissions: [...ROLE_PERMISSIONS[role]] })
    .onConflictDoUpdate({ target: staffRoles.name, set: { permissions: sql`excluded.permissions` } });
  const created = (await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, role)).limit(1))[0];
  if (created === undefined) throw appError("INTERNAL", { details: "staff role row missing after upsert" });
  return created.id;
}

async function identityTaken(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(sql`lower(${staffUsers.email}) = ${email}`)
    .limit(1);
  return rows[0] !== undefined;
}

async function activeOwnerCount(db: Db, excludeId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(staffUsers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffUsers.roleId))
    .where(and(eq(staffRoles.name, "owner"), eq(staffUsers.isActive, true), sql`${staffUsers.id} <> ${excludeId}`));
  return Number(rows[0]?.n ?? 0);
}

/**
 * The bar an initial password typed by the owner has to clear. `isAcceptablePassword` is the same
 * check `staffChangePassword` runs; the two equality tests close the accident this is really about
 * - an autofilled or copy-pasted identity ending up as the account's password.
 */
function assertInitialPassword(password: string, identity: string, name: string): void {
  const acceptable = isAcceptablePassword(password, EMPTY_BREACHED);
  if (!acceptable.ok) throw appError("VALIDATION", { httpStatus: 400, fa: PASSWORD_FA[acceptable.reason] });
  const folded = password.trim().toLowerCase();
  if (folded === identity.trim().toLowerCase() || folded === name.trim().toLowerCase()) {
    throw appError("VALIDATION", { httpStatus: 400, fa: SAME_AS_IDENTITY_FA });
  }
}

/**
 * The owner creates a staff member: name, login identity, role, and a one-time password that is
 * returned ONCE (never stored in the clear, never logged, never written to the audit row). The
 * account is active straight away with `must_change_password`, so the first login runs the flow
 * that already exists - password, then TOTP enrolment, then the panel.
 */
export async function createStaff(
  db: Db,
  i: { email: string; name: string; role: RoleName; password?: string },
  actor: Actor,
): Promise<{ staff: StaffRow; password: string }> {
  const email = i.email.trim().toLowerCase();
  if (await identityTaken(db, email)) throw appError("CONFLICT", { httpStatus: 409, fa: "این نام کاربری قبلاً ثبت شده است" });
  const roleId = await roleIdFor(db, i.role);
  // A hand-typed initial password meets the same bar as one the staff member picks later, and may
  // never BE the login identity or the person's name: a browser password manager will happily fill
  // that box with the username it just watched being typed, and the owner would then hand out an
  // account whose password is public knowledge. Generated passwords skip the check by construction.
  if (i.password !== undefined) assertInitialPassword(i.password, email, i.name);
  const password = i.password ?? generateStaffPassword();
  const id = ulid();
  await db.insert(staffUsers).values({
    id,
    email,
    name: i.name,
    passwordHash: await hashPassword(password),
    roleId,
    isActive: true,
    totpEnabled: false,
    mustChangePassword: true,
  });
  // The audit row records WHO was created with WHICH role - never the password or its hash.
  await audit.log(db, actor, "staff.create", "staff_users", id, null, { email, name: i.name, role: i.role });
  const after = (await listStaff(db)).find((row) => row.id === id);
  if (after === undefined) throw appError("INTERNAL");
  return { staff: after, password };
}

/**
 * A fresh one-time password for a staff member who lost theirs. Returned once, forces a change on
 * the next login, and ends every session the account currently holds (including the lockout, so the
 * owner does not have to wait out a 15-minute lock they just fixed).
 */
export async function resetStaffPassword(db: Db, id: string, actor: Actor): Promise<{ password: string }> {
  const current = (await listStaff(db)).find((row) => row.id === id);
  if (current === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  const password = generateStaffPassword();
  await db
    .update(staffUsers)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, failedAttempts: 0, lockedUntil: null })
    .where(eq(staffUsers.id, id));
  await db.delete(staffSessions).where(eq(staffSessions.staffId, id));
  await audit.log(db, actor, "staff.password.reset", "staff_users", id, null, { email: current.email });
  return { password };
}

/**
 * Removes the account for good. `staff_sessions` and `webauthn_credentials` cascade; the six history
 * columns that point at a staff member (who uploaded a photo, who answered a question, who moved an
 * order) are ON DELETE SET NULL as of migration 0004 - the record of the event stays, the name on it
 * does not. The last active owner can never be deleted, and nobody deletes themselves.
 */
export async function deleteStaff(db: Db, id: string, actor: Actor): Promise<void> {
  const current = (await listStaff(db)).find((row) => row.id === id);
  if (current === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  if (actor.type === "staff" && actor.id === id) throw appError("CONFLICT", { fa: "حساب خودتان را نمی‌توانید حذف کنید" });
  if (current.role === "owner" && (await activeOwnerCount(db, id)) === 0) {
    throw appError("CONFLICT", { fa: "آخرین مالک فعال را نمی‌توان حذف کرد" });
  }
  await db.delete(staffUsers).where(eq(staffUsers.id, id));
  await audit.log(db, actor, "staff.delete", "staff_users", id, { email: current.email, name: current.name, role: current.role }, null);
}

export async function updateStaff(
  db: Db,
  id: string,
  patch: { name?: string; role?: RoleName; isActive?: boolean; forceTotpReenrol?: boolean },
  actor: Actor,
): Promise<StaffRow> {
  const current = (await listStaff(db)).find((s) => s.id === id);
  if (current === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });

  const losesOwner = current.role === "owner" && ((patch.role !== undefined && patch.role !== "owner") || patch.isActive === false);
  if (losesOwner && (await activeOwnerCount(db, id)) === 0) {
    throw appError("CONFLICT", { fa: "آخرین مالک فعال را نمی‌توان غیرفعال یا تنزل داد" });
  }

  const set: Partial<typeof staffUsers.$inferInsert> = {};
  if (patch.name !== undefined && patch.name !== current.name) set.name = patch.name;
  if (patch.role !== undefined && patch.role !== current.role) set.roleId = await roleIdFor(db, patch.role);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (patch.forceTotpReenrol === true) {
    set.totpSecretEnc = null;
    set.totpEnabled = false;
  }
  if (Object.keys(set).length > 0) await db.update(staffUsers).set(set).where(eq(staffUsers.id, id));
  // A role change, a deactivation or a TOTP reset all end the running sessions.
  if (patch.forceTotpReenrol === true || patch.isActive === false || set.roleId !== undefined) {
    await db.delete(staffSessions).where(eq(staffSessions.staffId, id));
  }
  await audit.log(
    db,
    actor,
    "staff.update",
    "staff_users",
    id,
    { name: current.name, role: current.role, isActive: current.isActive, totpEnabled: current.totpEnabled },
    { name: patch.name ?? current.name, role: patch.role ?? current.role, isActive: patch.isActive ?? current.isActive, forceTotpReenrol: patch.forceTotpReenrol === true },
  );
  const after = (await listStaff(db)).find((s) => s.id === id);
  if (after === undefined) throw appError("INTERNAL");
  return after;
}
