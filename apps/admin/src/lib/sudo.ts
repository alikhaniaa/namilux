import "server-only";
import { cookies } from "next/headers";
import { SUDO_COOKIE, signSudoToken, staffSudo, verifySudoToken } from "@namilux/core";
import type { StaffUser } from "@namilux/core";
import { db } from "./db";
import { env } from "@/env";
import { sudoCookie } from "./session";

export async function hasFreshSudo(staff: StaffUser): Promise<boolean> {
  const token = (await cookies()).get(SUDO_COOKIE)?.value;
  if (token === undefined) return false;
  return verifySudoToken(token, staff.sessionId, env.SESSION_PEPPER) !== null;
}

export async function issueSudo(staff: StaffUser, code: string): Promise<{ until: Date }> {
  const { until } = await staffSudo(db, staff.id, code);
  const token = signSudoToken(staff.sessionId, until, env.SESSION_PEPPER);
  (await cookies()).set(sudoCookie(token));
  return { until };
}
