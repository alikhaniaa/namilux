import { randomInt } from "node:crypto";
import { analytics, beaconSchema, cspReportSchema, getSettings, security } from "@namilux/core";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/http-handler";
import { take } from "@/lib/ratelimit";

const BEACON_CAP = 1024;
const CSP_CAP = 8 * 1024;
const CSP_SAMPLE = 20;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);
  const isCsp = new URL(req.url).searchParams.get("csp") === "1";
  if (!take("beacon.ip", ip).ok) return noContent();
  const raw = await req.text().catch(() => "");
  if (raw.length === 0 || raw.length > (isCsp ? CSP_CAP : BEACON_CAP)) return noContent();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return noContent();
  }
  if (isCsp) {
    const parsed = cspReportSchema.safeParse(json);
    if (parsed.success && randomInt(CSP_SAMPLE) === 0) {
      const report = parsed.data as Record<string, unknown>;
      const inner = (report["csp-report"] ?? report["body"] ?? report) as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, 200) : "");
      const detail = {
        directive: str(inner["violated-directive"] ?? inner["effectiveDirective"] ?? inner["effective-directive"]),
        blocked: str(inner["blocked-uri"] ?? inner["blockedURL"]),
        page: str(inner["document-uri"] ?? inner["documentURL"]),
      };
      void security.event(db, "csp.report", detail, ip).catch(() => undefined);
    }
    return noContent();
  }
  const parsed = beaconSchema.safeParse(json);
  if (parsed.success) {
    const ev = parsed.data;
    const ua = req.headers.get("user-agent") ?? "";
    void getSettings(db)
      .then((settings) => analytics.record(db, ev, { ip, ua, sampling: settings["analytics.sampling"] }))
      .catch(() => undefined);
  }
  return noContent();
}
