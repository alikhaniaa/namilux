export function requestOrigin(url: URL, headers: Headers, trustProxy: boolean): { host: string; protocol: string } {
  if (!trustProxy) return { host: url.host, protocol: url.protocol };
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || url.host;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { host, protocol: proto === "https" || proto === "http" ? `${proto}:` : url.protocol };
}

export function redirectTarget(host: string, protocol: string, pathname: string, search: string): URL {
  // Assigning URL.host without a port retains an existing internal port in WHATWG URL.
  // Start with the complete target origin so :3000 cannot leak into a public redirect.
  const target = new URL(`${protocol}//${host}`);
  target.pathname = pathname;
  target.search = search;
  return target;
}
