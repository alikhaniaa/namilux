import { httpJson } from "../http";
import type { CdnDriver } from "./types";

const API = "https://napi.arvancloud.ir/cdn/4.0/domains";
const BATCH = 100;
const TIMEOUT_MS = 15_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function arvanCdn(cfg: { apiKey: string; domain: string }): CdnDriver {
  const endpoint = `${API}/${cfg.domain}/caching/purge`;
  const headers = { Authorization: `apikey ${cfg.apiKey}`, "content-type": "application/json" };
  // 429 is a rate-limit, retried once; 5xx/network also retried; 4xx (bad request) is not.
  const retryOn = (r: Response | null, e: unknown): boolean =>
    (e !== null && e !== undefined) || (r !== null && (r.status === 429 || r.status >= 500));

  return {
    key: "arvan",
    async purgeUrls(urls: string[]): Promise<{ ok: boolean; purged: number; error?: string }> {
      // Only absolute URLs on the configured domain are valid Arvan purge targets; drop the rest.
      const onDomain = urls.filter((u) => {
        try {
          return new URL(u).hostname === cfg.domain;
        } catch {
          return false;
        }
      });
      const dropped = urls.length - onDomain.length;
      if (onDomain.length === 0) {
        return { ok: true, purged: 0, ...(dropped > 0 ? { error: `dropped ${dropped} foreign urls` } : {}) };
      }
      let purged = 0;
      for (const group of chunk(onDomain, BATCH)) {
        const res = await httpJson<{ message?: string }>(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ purge: "individual", purge_urls: group }),
          timeoutMs: TIMEOUT_MS,
          retries: 1,
          retryOn,
        });
        if (!res.ok) return { ok: false, purged, error: res.data?.message ?? `arvan purge http ${res.status}` };
        purged += group.length;
      }
      return { ok: true, purged, ...(dropped > 0 ? { error: `dropped ${dropped} foreign urls` } : {}) };
    },
    async purgeAll(): Promise<{ ok: boolean; error?: string }> {
      const res = await httpJson<{ message?: string }>(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ purge: "all" }),
        timeoutMs: TIMEOUT_MS,
        retries: 1,
        retryOn,
      });
      return res.ok ? { ok: true } : { ok: false, error: res.data?.message ?? `arvan purge-all http ${res.status}` };
    },
  };
}
