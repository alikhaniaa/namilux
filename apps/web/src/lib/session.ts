import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { clientIpFromHeaders } from "@namilux/config/client-ip";
import { AppError, ERROR_FA, SESSION_COOKIE, resolveSession } from "@namilux/core";
import type { SessionUser } from "@namilux/core";
import { db } from "./db";
import { env } from "@/env";

const SECURE = env.SITE_ORIGIN.startsWith("https://");

/** Re-verification window for sensitive actions: a fresh OTP within 10 minutes. */
export const REVERIFY_MS = 10 * 60 * 1000;

// React cache() dedupes the session lookup across a single server render/request. Never throws:
// a missing/invalid/blocked session simply resolves to null.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    return await resolveSession(db, token);
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
  return user;
}

export function isRecentlyVerified(user: SessionUser, now = Date.now()): boolean {
  if (user.lastOtpAt === null) return false;
  return now - new Date(user.lastOtpAt).getTime() <= REVERIFY_MS;
}

export function sessionCookie(
  token: string,
  expires: Date,
): { name: string; value: string; httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; expires: Date } {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", expires };
}

export function clearSessionCookie(): { name: string; value: ""; maxAge: 0; path: "/" } {
  return { name: SESSION_COOKIE, value: "", maxAge: 0, path: "/" };
}

export function clientIp(req: Request): string {
  // Last hop of X-Forwarded-For behind the trusted edge (never the client-controlled first hop).
  return clientIpFromHeaders(req.headers, env.TRUST_PROXY);
}
