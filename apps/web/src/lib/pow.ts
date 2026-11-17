import "server-only";
import { appError } from "@namilux/core";
import { verifySolution } from "@namilux/integrations";
import { parsePowToken, powKey } from "./otp-config";

export function ip24(ip: string): string {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4 !== null) return `${v4[1] ?? "0"}.${v4[2] ?? "0"}.${v4[3] ?? "0"}.0/24`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::/64`;
  return ip === "" ? "unknown" : ip;
}

export function powScope(kind: "contact" | "newsletter", ip: string): string {
  return `${kind}:${ip24(ip)}`;
}

export function assertPow(token: string | undefined, scope: string): void {
  const sol = token === undefined ? null : parsePowToken(token);
  if (sol === null || !verifySolution({ key: powKey() }, scope, sol).ok) {
    throw appError("CAPTCHA_REQUIRED", { fa: "برای ادامه، لطفاً چند ثانیه صبر کنید و دوباره تلاش کنید" });
  }
}
