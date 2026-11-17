import { createHash, createHmac } from "node:crypto";
import { internalRevalidateTarget } from "@namilux/config/internal-target";
import { isCacheTag, jobs } from "@namilux/core";
import type { Handler } from "../runtime";

const TIMEOUT_MS = 10_000;

export const cacheRevalidate: Handler = async ({ db, env, log, job }) => {
  const raw = (job.payload as { tags?: unknown }).tags;
  const tags = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string" && isCacheTag(t)) : [];
  if (tags.length === 0) {
    log.warn({ jobId: job.id }, "cache-revalidate: no valid tags");
    return;
  }

  const origin = (env.SITE_ORIGIN) ?? "";
  const key = (env.INTERNAL_SIGNING_KEY) ?? "";
  const body = JSON.stringify({ tags });
  const ts = String(Date.now());
  const sig = createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");

  // Over loopback, addressed as the public host - see internalRevalidateTarget for why.
  const post = async (internalUrl: string, publicOrigin: string): Promise<Response> => {
    const target = internalRevalidateTarget(internalUrl, publicOrigin);
    return fetch(target.url, {
      method: "POST",
      headers: { ...target.headers, "content-type": "application/json", "x-nl-ts": ts, "x-nl-sig": sig },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  const res = await post(env.WEB_INTERNAL_URL, origin);
  if (!res.ok) throw new Error(`revalidate http ${res.status}`); // retryable

  // Follow the in-app flip with an edge purge; dedupe repeated flips of the same tag set per minute.
  const bucket = Math.floor(Date.now() / 60_000);
  const digest = createHash("sha256").update([...tags].sort().join(",")).digest("hex").slice(0, 16);
  await jobs.enqueue(db, "cdn.purge", { tags }, { uniqueKey: `cdn.purge:${digest}:${bucket}` });
  log.info({ tags: tags.length, outcome: "revalidated" }, "cache revalidated");
};
