import { z } from "zod";
import { AppError, ERROR_FA, totpCodeSchema } from "@namilux/core";
import { staffTotpEnrolConfirm, staffTotpEnrolStart, staffVerifyTotp } from "@namilux/core";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ok, fail, clientIp, sameOrigin, logInternal } from "@/lib/http-handler";
import { csrfCheck, issueCsrf } from "@/lib/csrf";
import { staffCookie } from "@/lib/session";

const bodySchema = z
  .object({ tempToken: z.string().min(1).max(600), code: totpCodeSchema, enrol: z.boolean().optional() })
  .strict();

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("enrol") !== "1") return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    const tempToken = url.searchParams.get("tempToken") ?? "";
    const { secretBase32, otpauth } = await staffTotpEnrolStart(db, tempToken);
    return ok({ otpauthUri: otpauth, secret: secretBase32 });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    logInternal(crypto.randomUUID(), e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    if (!csrfCheck(req)) return fail(new AppError("FORBIDDEN", 403, "درخواست نامعتبر است"));
    const raw = await req.text();
    if (raw.length > 1024) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));

    const args = { tempToken: parsed.data.tempToken, code: parsed.data.code, ip: clientIp(req), ua: req.headers.get("user-agent") ?? "" };
    const { token } = parsed.data.enrol === true ? await staffTotpEnrolConfirm(db, args) : await staffVerifyTotp(db, args);

    const jar = await cookies();
    jar.set(staffCookie(token));
    jar.set(issueCsrf());
    return ok({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    logInternal(crypto.randomUUID(), e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
