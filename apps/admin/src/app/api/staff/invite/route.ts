import { z } from "zod";
import { AppError, ERROR_FA, isAppError, staffAcceptInvite, staffPasswordSchema } from "@namilux/core";
import { csrfCheck } from "@/lib/csrf";
import { db } from "@/lib/db";
import { fail, ok, sameOrigin, logInternal } from "@/lib/http-handler";

const schema = z.object({ token: z.string().min(16).max(600), password: staffPasswordSchema }).strict();

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    if (!csrfCheck(req)) return fail(new AppError("FORBIDDEN", 403, "درخواست نامعتبر است"));
    const raw = await req.text();
    if (raw.length > 2048) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    const { staffId } = await staffAcceptInvite(db, { inviteToken: parsed.data.token, password: parsed.data.password, breached: new Set<string>() });
    return ok({ staffId });
  } catch (e) {
    if (isAppError(e)) return fail(e);
    logInternal(crypto.randomUUID(), e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
