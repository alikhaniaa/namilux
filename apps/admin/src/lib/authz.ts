import "server-only";
import { notFound } from "next/navigation";
import { AppError, SUDO_COOKIE, assertCan, can, requiresSudo, verifySudoToken } from "@namilux/core";
import type { Permission, StaffUser } from "@namilux/core";
import { env } from "@/env";
import { requireStaff } from "./session";

const SUDO_FA = "برای این کار باید رمز تأیید دومرحله‌ای را دوباره وارد کنید";

export function sudoRequired(permission: Permission): AppError {
  return new AppError("FORBIDDEN", 403, SUDO_FA, { sudoRequired: true, permission });
}

export function guard(staff: StaffUser, permission: Permission, sudoToken?: string): void {
  assertCan(staff, permission);
  if (requiresSudo(permission)) {
    const ok = sudoToken !== undefined && verifySudoToken(sudoToken, staff.sessionId, env.SESSION_PEPPER) !== null;
    if (!ok) throw sudoRequired(permission);
  }
}

/**
 * The page-level guard. A staff member without the permission gets the 404 screen, whose Persian
 * copy is written for exactly this case («شاید نشانی اشتباه باشد یا دسترسی این بخش را نداشته
 * باشید») - it neither confirms the page exists nor drops them on the dashboard with no
 * explanation, which is what a bare redirect did. The API routes answer 403 through `adminHandler`;
 * this is the screen behind the hidden menu entry.
 */
export async function requirePermission(p: Permission): Promise<StaffUser> {
  const staff = await requireStaff();
  if (!can(staff, p)) notFound();
  return staff;
}

/**
 * For routes where sudo is conditional (e.g. bulk-price apply but not preview): read the nl_sudo
 * cookie off the request and throw sudoRequired(permission) when it is missing/stale.
 */
export function assertFreshSudo(req: Request, staff: StaffUser, permission: Permission): void {
  const raw = req.headers.get("cookie");
  let token: string | undefined;
  if (raw !== null) {
    for (const part of raw.split(";")) {
      const eq = part.indexOf("=");
      if (eq !== -1 && part.slice(0, eq).trim() === SUDO_COOKIE) token = part.slice(eq + 1).trim();
    }
  }
  if (token === undefined || verifySudoToken(token, staff.sessionId, env.SESSION_PEPPER) === null) {
    throw sudoRequired(permission);
  }
}
