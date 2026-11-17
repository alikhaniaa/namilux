import "server-only";
import { createHash, createHmac } from "node:crypto";
import { internalRevalidateTarget } from "@namilux/config/internal-target";
import { jobs } from "@namilux/core";
import { db } from "./db";
import { env } from "@/env";

export async function send(tags: string[]): Promise<{ ok: boolean }> {
  if (tags.length === 0) return { ok: true };
  const body = JSON.stringify({ tags });
  const ts = Date.now().toString();
  const sig = createHmac("sha256", env.INTERNAL_SIGNING_KEY).update(`${ts}.${body}`).digest("hex");

  // Over loopback, addressed as the public host - see internalRevalidateTarget for why.
  const post = async (internalUrl: string, publicOrigin: string): Promise<boolean> => {
    try {
      const target = internalRevalidateTarget(internalUrl, publicOrigin);
      const res = await fetch(target.url, {
        method: "POST",
        headers: { ...target.headers, "content-type": "application/json", "x-nl-ts": ts, "x-nl-sig": sig },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const ok = await post(env.WEB_INTERNAL_URL, env.SITE_ORIGIN);

  try {
    const uniqueKey = `cdn.purge:${createHash("sha256").update(body).digest("hex").slice(0, 32)}`;
    await jobs.enqueue(db, "cdn.purge", { tags }, { uniqueKey });
  } catch {
    // the revalidate itself already updated the origin cache; a purge miss is not fatal.
  }
  return { ok };
}
