/**
 * Where the admin and the worker post `/api/internal/revalidate/`.
 *
 * Not at the public origin. Caddy answers 404 for `/api/internal/*` on the storefront's public
 * hostname - deliberately, that path is not for the internet - so a POST to `${SITE_ORIGIN}` never
 * reached the app and every `cache.revalidate` job failed with «revalidate http 404», leaving admin
 * edits invisible until the caches expired on their own (found on the box, 7 Sep 2026).
 *
 * So the call goes over loopback, straight to the Next process. The storefront still has to believe
 * it is being addressed by its canonical hostname: with `TRUST_PROXY` on, its proxy compares
 * `x-forwarded-host` against `SITE_ORIGIN` and answers a 301 to the canonical origin when they
 * differ - which a POST would follow into a GET, or refuse outright. Sending the public host in
 * `Host`/`X-Forwarded-Host` and `https` in `X-Forwarded-Proto` keeps that redirect silent, and
 * `X-Forwarded-For: 127.0.0.1` satisfies the route's own private-address gate.
 */

export const INTERNAL_REVALIDATE_PATH = "/api/internal/revalidate/";

export type InternalTarget = { url: string; headers: Record<string, string> };

/** Strips a trailing slash so `${base}${path}` never doubles it. */
const trimEnd = (s: string): string => s.replace(/\/+$/, "");

/**
 * `internalUrl` is the loopback base (`http://127.0.0.1:3000`), `publicOrigin` the site's real
 * origin (`https://namilux.ir`, or `https://<ip>:8200` for the instalment site - the port is part
 * of the host and has to travel with it).
 */
export function internalRevalidateTarget(internalUrl: string, publicOrigin: string): InternalTarget {
  const host = new URL(publicOrigin).host;
  const proto = new URL(publicOrigin).protocol === "http:" ? "http" : "https";
  return {
    url: `${trimEnd(internalUrl)}${INTERNAL_REVALIDATE_PATH}`,
    headers: {
      host,
      "x-forwarded-host": host,
      "x-forwarded-proto": proto,
      "x-forwarded-for": "127.0.0.1",
    },
  };
}
