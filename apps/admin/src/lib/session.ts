import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromHeaders } from "@namilux/config/client-ip";
import { STAFF_SESSION_COOKIE, SUDO_COOKIE, staffResolve } from "@namilux/core";
import type { StaffUser } from "@namilux/core";
import { db } from "./db";
import { env } from "@/env";

const SECURE = env.ADMIN_ORIGIN.startsWith("https://");

export async function serverIp(): Promise<string> {
  // Last hop of X-Forwarded-For behind the trusted edge - the first hop is client-controlled and the
  // staff session's /24 binding would otherwise be trivially satisfiable by a stolen cookie.
  return clientIpFromHeaders(await headers(), env.TRUST_PROXY);
}

// React cache() dedupes the lookup across one render/request. Never throws: a missing/invalid/expired
// session resolves to null. staffResolve enforces the /24 IP binding and revokes on mismatch.
export const currentStaff = cache(async (): Promise<StaffUser | null> => {
  try {
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    return await staffResolve(db, token, await serverIp());
  } catch {
    return null;
  }
});

export async function requireStaff(): Promise<StaffUser> {
  const staff = await currentStaff();
  if (staff === null) redirect("/login");
  return staff;
}

export function staffCookie(
  token: string,
): { name: string; value: string; httpOnly: true; secure: boolean; sameSite: "strict"; path: "/"; maxAge: number } {
  return { name: STAFF_SESSION_COOKIE, value: token, httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: 43_200 };
}

export function clearStaffCookie(): { name: string; value: ""; maxAge: 0; path: "/" } {
  return { name: STAFF_SESSION_COOKIE, value: "", maxAge: 0, path: "/" };
}

export function sudoCookie(
  token: string,
): { name: string; value: string; httpOnly: true; secure: boolean; sameSite: "strict"; path: "/"; maxAge: number } {
  return { name: SUDO_COOKIE, value: token, httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: 300 };
}

export function clearSudoCookie(): { name: string; value: ""; maxAge: 0; path: "/" } {
  return { name: SUDO_COOKIE, value: "", maxAge: 0, path: "/" };
}
