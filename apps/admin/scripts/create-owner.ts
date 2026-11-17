import { adminEnv } from "@namilux/config";
import { ROLE_NAMES, ROLE_PERMISSIONS, generateStaffPassword, hashPassword, ulid } from "@namilux/core";
import { createDb, eq, sql, staffRoles, staffUsers } from "@namilux/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim() ?? "مدیر";
  if (email === undefined || !email.includes("@")) {
    console.error("Usage: pnpm admin:create-owner --email owner@example.com [--name \"...\"]");
    process.exit(1);
  }
  const env = adminEnv();
  const db = createDb("admin", { url: env.DATABASE_URL_ADMIN, applicationName: "namilux-create-owner" });

  // 1. ensure every role row exists (idempotent upsert of the permission list). `owner` is the head
  //    admin this script creates; `admin` is the row the owner then assigns from the staff screen.
  for (const roleName of ROLE_NAMES) {
    await db
      .insert(staffRoles)
      .values({ name: roleName, permissions: [...ROLE_PERMISSIONS[roleName]] })
      .onConflictDoUpdate({ target: staffRoles.name, set: { permissions: sql`excluded.permissions` } });
  }
  const ownerRole = (await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, "owner")).limit(1))[0];
  if (ownerRole === undefined) throw new Error("owner role missing after upsert");

  const existing = (
    await db.select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.roleId, ownerRole.id)).limit(1)
  )[0];

  const password = generateStaffPassword();
  const passwordHash = await hashPassword(password);

  if (existing !== undefined) {
    if (!(flag("reset-password") && flag("i-am-the-owner"))) {
      console.error("An owner already exists. To rotate its password: --reset-password --i-am-the-owner");
      process.exit(1);
    }
    await db
      .update(staffUsers)
      .set({ passwordHash, mustChangePassword: true, failedAttempts: 0, lockedUntil: null })
      .where(eq(staffUsers.id, existing.id));
    console.log(`\nOwner password reset. One-time password (change on first login):\n\n    ${password}\n`);
  } else {
    await db.insert(staffUsers).values({
      id: ulid(),
      email,
      name,
      passwordHash,
      roleId: ownerRole.id,
      isActive: true,
      totpEnabled: false,
      mustChangePassword: true,
    });
    console.log(`\nOwner created: ${email}\nOne-time password (change on first login, TOTP enrolled on first login):\n\n    ${password}\n`);
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
