import { clientIpFromHeaders, ipInCidrs, parseCidrList } from "@namilux/config/client-ip";
import { STAFF_SESSION_COOKIE, ulid } from "@namilux/core";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { adminHeaders } from "@/security/headers";

const MAX_URL_LENGTH = 2048;
const PAGE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? "https://admin.namilux.ir";
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://namilux.ir";
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
const ALLOWED_CIDRS = parseCidrList(process.env.ADMIN_ALLOWED_CIDRS);

function ipAllowed(ip: string): boolean {
  if (ALLOWED_CIDRS.length === 0) return true;
  return ipInCidrs(ip, ALLOWED_CIDRS);
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const PUBLIC_PATHS = new Set(["/login", "/login/totp", "/login/invite", "/offline", "/healthz", "/healthz/ready", "/robots.txt", "/manifest.webmanifest", "/sw.js"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/icons/", "/.well-known/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname === "/api/auth") return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function proxy(req: NextRequest): NextResponse {
  const url = req.nextUrl;
  const requestId = ulid();

  if (!ipAllowed(clientIpFromHeaders(req.headers, TRUST_PROXY))) return new NextResponse(null, { status: 404 });
  if (req.url.length > MAX_URL_LENGTH) return new NextResponse(null, { status: 414 });

  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
  if (!isApi && !PAGE_METHODS.has(req.method)) {
    return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
  }

  // Session-cookie gate (presence only; the page/handler does the real staffResolve).
  if (!isPublic(url.pathname)) {
    const hasCookie = req.cookies.get(STAFF_SESSION_COOKIE) !== undefined;
    if (!hasCookie) {
      if (isApi) return new NextResponse(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED" } }), { status: 401 });
      const to = new URL("/login", ADMIN_ORIGIN);
      to.searchParams.set("next", url.pathname + url.search);
      return NextResponse.redirect(to);
    }
  }

  const value = nonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", value);
  requestHeaders.set("x-request-id", requestId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { key, value: headerValue } of adminHeaders(value, SITE_ORIGIN)) res.headers.set(key, headerValue);
  res.headers.set("x-nonce", value);
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
