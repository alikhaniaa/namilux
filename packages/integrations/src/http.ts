export type HttpOpts = { timeoutMs?: number; retries?: number; retryOn?: (res: Response | null, err: unknown) => boolean; headers?: Record<string, string>; redirect?: "error" };
export class ProviderError extends Error { constructor(public provider: string, message: string, public status?: number, public retryable = false) { super(message); } }

const MAX_BODY_BYTES = 1_048_576;

export function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

const defaultRetryOn = (res: Response | null, err: unknown): boolean =>
  err !== null && err !== undefined ? true : res !== null && res.status >= 500;

export async function httpJson<T>(
  url: string,
  init: RequestInit & HttpOpts,
): Promise<{ ok: boolean; status: number; data: T | null; raw: string }> {
  const { timeoutMs = 15000, retries = 2, retryOn = defaultRetryOn, headers, redirect = "error", ...rest } = init;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...rest,
        ...(headers ? { headers } : {}),
        redirect,
        signal: withTimeout(timeoutMs),
      });
      const buf = await res.arrayBuffer();
      const raw = new TextDecoder().decode(buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf);
      if (!res.ok && retryOn(res, null) && attempt < retries) continue;
      let data: T | null = null;
      try {
        data = raw === "" ? null : (JSON.parse(raw) as T);
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, raw };
    } catch (err) {
      lastErr = err;
      if (retryOn(null, err) && attempt < retries) continue;
      throw new ProviderError("http", err instanceof Error ? err.message : "request failed", undefined, true);
    }
  }
  throw new ProviderError("http", lastErr instanceof Error ? lastErr.message : "request failed", undefined, true);
}
