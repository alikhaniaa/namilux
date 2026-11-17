import { AppError, ERROR_FA, staffLoginSchema } from "@namilux/core";
import { cookies } from "next/headers";
import { staffLogin } from "@namilux/core";
import { db } from "@/lib/db";
import { ok, fail, clientIp, sameOrigin, logInternal } from "@/lib/http-handler";
import { issueCsrf } from "@/lib/csrf";
import { clearSudoCookie, staffCookie } from "@/lib/session";

const WINDOW_MS = 10 * 60 * 1000;
const MAX = 10;
const hits = new Map<string, { n: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = hits.get(ip);
  if (cur === undefined || cur.reset < now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  cur.n += 1;
  return cur.n > MAX;
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    const raw = await req.text();
    if (raw.length > 1024) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
    const ip = clientIp(req);
    if (rateLimited(ip)) return fail(new AppError("RATE_LIMITED", 429, ERROR_FA.RATE_LIMITED));

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    }
    const parsed = staffLoginSchema.safeParse(json);
    if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));

    const { needsTotp, tempToken, token } = await staffLogin(db, {
      email: parsed.data.email,
      password: parsed.data.password,
      ip,
      ua: req.headers.get("user-agent") ?? "",
    });
    const jar = await cookies();
    jar.set(issueCsrf());
    if (token !== undefined) {
      jar.set(staffCookie(token));
      jar.set(clearSudoCookie());
      return ok({ authenticated: true });
    }
    return ok({ needsTotp, tempToken });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    logInternal(crypto.randomUUID(), e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
