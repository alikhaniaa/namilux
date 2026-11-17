import { cookies } from "next/headers";
import { SESSION_COOKIE, revokeSession } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";
import { clearSessionCookie } from "@/lib/session";

export const POST = handler({
  auth: "session",
  bodyCap: 0,
  run: async () => {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (token !== undefined && token !== "") await revokeSession(db, token);
    jar.set(clearSessionCookie());
    return { ok: true };
  },
});
