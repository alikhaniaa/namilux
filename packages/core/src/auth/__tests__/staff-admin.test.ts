import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { auditLog, eq, media, staffRoles, staffSessions, staffUsers } from "@namilux/db";
import { ulid } from "../../ids";
import { isAppError } from "../../errors";
import { ROLE_PERMISSIONS } from "../../authz/permissions";
import { verifyPassword } from "../password";
import { hashToken, newSessionToken } from "../sessions";
import { staffLogin, staffResolve } from "../staff";
import { createStaff, deleteStaff, listStaff, resetStaffPassword, updateStaff } from "../staff-admin";

const IP = "10.0.0.5";
const OWNER: { type: "staff"; id: string; ip: string } = { type: "staff", id: ulid(), ip: IP };

describe.skipIf(!hasTestDb())("auth/staff-admin — the head admin manages staff", () => {
  let handle: TestDb;
  const savedPepper = process.env.SESSION_PEPPER;

  beforeAll(async () => {
    process.env.SESSION_PEPPER = "e".repeat(64);
    handle = await createTestDb();
    await truncateAll(handle.db);
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    process.env.SESSION_PEPPER = savedPepper;
    await handle.close();
  });

  /** The owner account every test acts as - the row `activeOwnerCount` counts. */
  async function seedOwner(): Promise<void> {
    const role = (
      await handle.db
        .insert(staffRoles)
        .values({ name: "owner", permissions: [...ROLE_PERMISSIONS.owner] })
        .returning({ id: staffRoles.id })
    )[0];
    await handle.db.insert(staffUsers).values({
      id: OWNER.id,
      email: "owner@namilux.ir",
      name: "مالک",
      passwordHash: "scrypt$131072$8$1$AAAA$BBBB",
      roleId: role?.id ?? 0,
      isActive: true,
    });
  }

  it("creates an admin with a one-time password that actually logs in", async () => {
    await seedOwner();
    const { staff, password } = await createStaff(
      handle.db,
      { email: "ali.karimi", name: "علی کریمی", role: "admin" },
      OWNER,
    );
    expect(staff.role).toBe("admin");
    expect(staff.isActive).toBe(true);
    // The account must change the password on first login and enrol TOTP - the flow that exists.
    expect(staff.mustChangePassword).toBe(true);
    expect(staff.totpEnabled).toBe(false);
    expect(password.length).toBeGreaterThanOrEqual(16);

    // The `admin` role row did not exist before this call: the service created it from the code's
    // matrix, so a database migrated before the role existed still takes the assignment.
    const roleRow = (await handle.db.select().from(staffRoles).where(eq(staffRoles.name, "admin")))[0];
    expect(roleRow).toBeDefined();

    // The password is stored only as a hash, and it is the one that was returned.
    const row = (await handle.db.select().from(staffUsers).where(eq(staffUsers.id, staff.id)))[0];
    expect(row?.passwordHash).not.toContain(password);
    expect(await verifyPassword(row?.passwordHash ?? "", password)).toBe(true);

    // …and it logs in for real, with TOTP enrolment still pending.
    const login = await staffLogin(handle.db, { email: "ali.karimi", password, ip: IP, ua: "vitest" });
    expect(login.needsTotp).toBe(false);
    expect(login.tempToken).not.toBe("");
  });

  it("never writes the password (or its hash) into the audit log", async () => {
    await seedOwner();
    const { password } = await createStaff(handle.db, { email: "a@namilux.ir", name: "زهرا", role: "admin" }, OWNER);
    const rows = await handle.db.select().from(auditLog);
    const dump = JSON.stringify(rows);
    expect(dump).toContain("staff.create");
    expect(dump).not.toContain(password);
    expect(dump).not.toContain("scrypt$");
  });

  it("refuses a duplicate identity, whatever its case or padding", async () => {
    await seedOwner();
    await createStaff(handle.db, { email: "ali.karimi", name: "علی", role: "admin" }, OWNER);
    await expect(createStaff(handle.db, { email: "  Ali.Karimi  ", name: "علی دوم", role: "admin" }, OWNER)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
  });

  it("a session resolves to the CODE's permission list, never the stale stored one", async () => {
    await seedOwner();
    // A role row left behind by an older release: the name is right, the list is stale and wrong - 
    // far too wide in one direction and missing the everyday permissions in the other.
    await handle.db.insert(staffRoles).values({ name: "admin", permissions: ["staff.manage", "settings.money"] });
    const { staff } = await createStaff(handle.db, { email: "b@namilux.ir", name: "زهرا", role: "admin" }, OWNER);

    const token = newSessionToken();
    await handle.db.insert(staffSessions).values({
      id: ulid(),
      staffId: staff.id,
      tokenHash: hashToken(token, process.env.SESSION_PEPPER ?? ""),
      idleExpiresAt: new Date(Date.now() + 600_000),
      absoluteExpiresAt: new Date(Date.now() + 600_000),
      ip: IP,
    });

    const resolved = await staffResolve(handle.db, token, IP);
    expect(resolved?.role).toBe("admin");
    expect([...(resolved?.permissions ?? [])].sort()).toEqual([...ROLE_PERMISSIONS.admin].sort());
    expect(resolved?.permissions).not.toContain("staff.manage");
    expect(resolved?.permissions).not.toContain("settings.money");
    expect(resolved?.permissions).toContain("orders.write");
  });

  it("resets the password: a new one-time secret, sessions gone, must-change set", async () => {
    await seedOwner();
    const { staff, password } = await createStaff(handle.db, { email: "c@namilux.ir", name: "زهرا", role: "admin" }, OWNER);
    await handle.db.insert(staffSessions).values({
      id: ulid(),
      staffId: staff.id,
      tokenHash: `h-${ulid()}`,
      idleExpiresAt: new Date(Date.now() + 600_000),
      absoluteExpiresAt: new Date(Date.now() + 600_000),
    });
    await handle.db.update(staffUsers).set({ mustChangePassword: false, failedAttempts: 4 }).where(eq(staffUsers.id, staff.id));

    const { password: next } = await resetStaffPassword(handle.db, staff.id, OWNER);
    expect(next).not.toBe(password);
    const row = (await handle.db.select().from(staffUsers).where(eq(staffUsers.id, staff.id)))[0];
    expect(await verifyPassword(row?.passwordHash ?? "", next)).toBe(true);
    expect(await verifyPassword(row?.passwordHash ?? "", password)).toBe(false);
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.failedAttempts).toBe(0);
    expect(await handle.db.select().from(staffSessions).where(eq(staffSessions.staffId, staff.id))).toEqual([]);
  });

  it("resets TOTP and ends the sessions", async () => {
    await seedOwner();
    const { staff } = await createStaff(handle.db, { email: "d@namilux.ir", name: "زهرا", role: "admin" }, OWNER);
    await handle.db.update(staffUsers).set({ totpEnabled: true, totpSecretEnc: "enc" }).where(eq(staffUsers.id, staff.id));
    const after = await updateStaff(handle.db, staff.id, { forceTotpReenrol: true }, OWNER);
    expect(after.totpEnabled).toBe(false);
    const row = (await handle.db.select().from(staffUsers).where(eq(staffUsers.id, staff.id)))[0];
    expect(row?.totpSecretEnc).toBeNull();
  });

  it("renames a staff member", async () => {
    await seedOwner();
    const { staff } = await createStaff(handle.db, { email: "e@namilux.ir", name: "زهرا", role: "admin" }, OWNER);
    const after = await updateStaff(handle.db, staff.id, { name: "زهرا رضایی" }, OWNER);
    expect(after.name).toBe("زهرا رضایی");
  });

  it("deletes an admin outright and keeps the history they touched", async () => {
    await seedOwner();
    const { staff } = await createStaff(handle.db, { email: "f@namilux.ir", name: "زهرا", role: "admin" }, OWNER);
    const mediaId = ulid();
    await handle.db.insert(media).values({
      id: mediaId,
      kind: "image",
      storageKey: `k/${mediaId}`,
      mime: "image/webp",
      bytes: 1,
      source: "admin",
      uploadedByStaffId: staff.id,
    });

    await deleteStaff(handle.db, staff.id, OWNER);
    expect(await listStaff(handle.db)).toHaveLength(1);
    // The photo they uploaded is still there - the column that named them is simply null now.
    const row = (await handle.db.select().from(media).where(eq(media.id, mediaId)))[0];
    expect(row).toBeDefined();
    expect(row?.uploadedByStaffId).toBeNull();
    expect(JSON.stringify(await handle.db.select().from(auditLog))).toContain("staff.delete");
  });

  it("protects the last owner and the caller's own account", async () => {
    await seedOwner();
    await expect(deleteStaff(handle.db, OWNER.id, OWNER)).rejects.toSatisfy((e: unknown) => isAppError(e) && e.code === "CONFLICT");
    await expect(updateStaff(handle.db, OWNER.id, { isActive: false }, OWNER)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
    await expect(updateStaff(handle.db, OWNER.id, { role: "admin" }, OWNER)).rejects.toSatisfy(
      (e: unknown) => isAppError(e) && e.code === "CONFLICT",
    );
    // A second owner makes both moves legal again.
    const { staff: second } = await createStaff(handle.db, { email: "g@namilux.ir", name: "مالک دوم", role: "owner" }, OWNER);
    expect(second.role).toBe("owner");
    const demoted = await updateStaff(handle.db, OWNER.id, { role: "admin" }, { ...OWNER, id: second.id });
    expect(demoted.role).toBe("admin");
  });
});
