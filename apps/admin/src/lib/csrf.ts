import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/env";

const SECURE = env.ADMIN_ORIGIN.startsWith("https://");
const CSRF_COOKIE = "nl_c";

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie");
  if (raw === null) return undefined;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function csrfCheck(req: Request): boolean {
  const header = req.headers.get("x-nl-csrf");
  const cookie = readCookie(req, CSRF_COOKIE);
  if (header === null || cookie === undefined || header === "" || cookie === "") return false;
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(cookie, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueCsrf(): { name: "nl_c"; value: string; sameSite: "strict"; secure: boolean; path: "/" } {
  return { name: CSRF_COOKIE, value: randomBytes(32).toString("base64url"), sameSite: "strict", secure: SECURE, path: "/" };
}
