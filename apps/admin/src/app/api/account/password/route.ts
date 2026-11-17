import { AppError, ERROR_FA, passwordChangeSchema, staffChangePassword } from "@namilux/core";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ok, fail, clientIp, sameOrigin } from "@/lib/http-handler";
import { csrfCheck, issueCsrf } from "@/lib/csrf";
import { currentStaff, staffCookie } from "@/lib/session";

const BREACHED: ReadonlySet<string> = new Set();

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    if (!csrfCheck(req)) return fail(new AppError("FORBIDDEN", 403, "درخواست نامعتبر است"));
    const staff = await currentStaff();
    if (staff === null) return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
    const raw = await req.text();
    if (raw.length > 4096) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    }
    const parsed = passwordChangeSchema.safeParse(json);
    if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    const ip = clientIp(req);
    // The change ends every session of this account, this browser's included. `reissue` opens one
    // fresh session for it and hands back the token, so the person who just set a password stays
    // signed in instead of landing back on /login; every other device is still logged out.
    const { token } = await staffChangePassword(
      db,
      staff.id,
      { current: parsed.data.current, next: parsed.data.next, breached: BREACHED, reissue: { ip, ua: req.headers.get("user-agent") ?? "" } },
      { type: "staff", id: staff.id, ip },
    );
    if (token !== null) {
      const jar = await cookies();
      jar.set(staffCookie(token));
      jar.set(issueCsrf());
    }
    return ok({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
