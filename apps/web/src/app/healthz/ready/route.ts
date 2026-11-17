import { pingDb } from "@namilux/db";
import { db } from "@/lib/db";
import { env } from "@/env";

// The container healthcheck and the uptime monitor both hit this; it must never be cached and must
// never leak a connection string or a role name on failure.
// DECISION: no `export const dynamic` - with `cacheComponents` Next rejects the segment config, and
// a handler that never says `"use cache"` is already uncached. `no-store` is set explicitly below
// and again by next.config's /api rule class.

export async function GET(): Promise<Response> {
  const build = env.NEXT_PUBLIC_BUILD_ID;
  try {
    const { ms } = await pingDb(db);
    return Response.json(
      { ok: true, build, db: { ok: true, ms } },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { ok: false, build, db: { ok: false } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
