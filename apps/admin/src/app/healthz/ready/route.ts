import { pingDb } from "@namilux/db";
import { db } from "@/lib/db";
import { env } from "@/env";

export async function GET(): Promise<Response> {
  const build = env.NEXT_PUBLIC_BUILD_ID;
  try {
    const { ms } = await pingDb(db);
    return Response.json({ ok: true, build, db: { ok: true, ms } }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, build, db: { ok: false } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
