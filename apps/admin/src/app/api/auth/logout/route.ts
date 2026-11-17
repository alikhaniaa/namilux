import { AppError, ERROR_FA, STAFF_SESSION_COOKIE, staffLogout } from "@namilux/core";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ok, fail, sameOrigin } from "@/lib/http-handler";
import { clearStaffCookie, clearSudoCookie } from "@/lib/session";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    const jar = await cookies();
    const token = jar.get(STAFF_SESSION_COOKIE)?.value;
    if (token !== undefined) await staffLogout(db, token);
    jar.set(clearStaffCookie());
    jar.set(clearSudoCookie());
    return ok({ ok: true });
  } catch {
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
