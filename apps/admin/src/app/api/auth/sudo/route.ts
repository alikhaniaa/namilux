import { AppError, ERROR_FA, staffSudoSchema } from "@namilux/core";
import { ok, fail, sameOrigin, logInternal } from "@/lib/http-handler";
import { csrfCheck } from "@/lib/csrf";
import { currentStaff } from "@/lib/session";
import { issueSudo } from "@/lib/sudo";

const WINDOW_MS = 5 * 60 * 1000;
const MAX = 5;
const hits = new Map<string, { n: number; reset: number }>();
function rateLimited(staffId: string): boolean {
  const now = Date.now();
  const cur = hits.get(staffId);
  if (cur === undefined || cur.reset < now) {
    hits.set(staffId, { n: 1, reset: now + WINDOW_MS });
    return false;
  }
  cur.n += 1;
  return cur.n > MAX;
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!sameOrigin(req)) return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
    if (!csrfCheck(req)) return fail(new AppError("FORBIDDEN", 403, "درخواست نامعتبر است"));
    const staff = await currentStaff();
    if (staff === null) return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
    if (rateLimited(staff.id)) return fail(new AppError("RATE_LIMITED", 429, ERROR_FA.RATE_LIMITED));

    const raw = await req.text();
    if (raw.length > 1024) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
    }
    const parsed = staffSudoSchema.safeParse(json);
    if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));

    const { until } = await issueSudo(staff, parsed.data.code);
    return ok({ until: until.toISOString() });
  } catch (e) {
    if (e instanceof AppError) return fail(e);
    logInternal(crypto.randomUUID(), e);
    return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL));
  }
}
