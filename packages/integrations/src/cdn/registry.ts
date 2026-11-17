import { arvanCdn } from "./arvan";
import { noneCdn } from "./none";
import type { CdnDriver } from "./types";

export function cdnDriver(env: {
  CDN_DRIVER: "none" | "arvan";
  ARVAN_API_KEY?: string;
  ARVAN_DOMAIN?: string;
}): CdnDriver {
  if (env.CDN_DRIVER === "arvan") {
    if (env.ARVAN_API_KEY === undefined || env.ARVAN_DOMAIN === undefined) {
      throw new Error("CDN_DRIVER=arvan requires ARVAN_API_KEY and ARVAN_DOMAIN");
    }
    return arvanCdn({ apiKey: env.ARVAN_API_KEY, domain: env.ARVAN_DOMAIN });
  }
  return noneCdn();
}
