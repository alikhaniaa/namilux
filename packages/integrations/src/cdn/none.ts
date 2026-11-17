import type { CdnDriver } from "./types";

export function noneCdn(): CdnDriver {
  return {
    key: "none",
    async purgeUrls(urls: string[]): Promise<{ ok: boolean; purged: number; error?: string }> {
      return { ok: true, purged: urls.length };
    },
    async purgeAll(): Promise<{ ok: boolean; error?: string }> {
      return { ok: true };
    },
  };
}
