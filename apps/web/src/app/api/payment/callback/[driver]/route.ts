import { PAYMENT_DRIVER_KEYS, getSettings, handleCallback, resultRedirect } from "@namilux/core";
import type { PaymentDriverKey } from "@namilux/core/constants";
import { paymentDrivers } from "@namilux/integrations";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/http-handler";
import { env } from "@/env";

// DECISION (2 Sep security pass): the route used to read the FIRST X-Forwarded-For hop without
// checking TRUST_PROXY, so a forged-callback attempt could stamp any address it liked into the
// security event. It now shares the handler's `clientIp` (last hop, trusted edge only).

/** Guard against an oversized form body - a callback is a handful of short fields. */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * No same-origin / CSRF check here, and that is deliberate: a gateway callback arrives cross-site by
 * definition. Nothing in the request is trusted instead - the amount is never read from it, only the
 * server-to-server verify against the STORED grand total moves money state, and an authority that
 * does not match a payment row is answered as a forgery.
 */
async function respond(req: Request, driver: string, params: Record<string, string>): Promise<Response> {
  const settings = await getSettings(db);
  const drivers = paymentDrivers(env);
  const result = await handleCallback(db, driver as PaymentDriverKey, params, {
    drivers: { payment: (key) => drivers.payment(key) },
    settings,
    ip: clientIp(req),
  });
  return new Response(null, {
    status: 303,
    headers: { location: resultRedirect(result, env.SITE_ORIGIN), "cache-control": "no-store" },
  });
}

function knownDriver(driver: string): boolean {
  return (PAYMENT_DRIVER_KEYS as readonly string[]).includes(driver);
}

const notFound = (): Response => new Response("Not Found", { status: 404, headers: { "cache-control": "no-store" } });

/** ZarinPal (and the mock) return the shopper with a query string. */
export async function GET(req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> {
  const driver = (await ctx.params).driver ?? "";
  if (!knownDriver(driver)) return notFound();
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return respond(req, driver, params);
}

/**
 * SnappPay does not redirect - it POSTs a form (transactionId, state, amount) to the returnURL. The
 * query string is merged in too, because a gateway may use either and the driver's `parseCallback`
 * is the thing that decides which fields carry the authority.
 *
 * `amount` is read and ignored on purpose: the verify goes out with the order's stored grand total,
 * so a callback that claims a different figure changes nothing.
 *
 * The 303 on the way out matters: it turns the POST into a GET so the shopper's result page is not
 * re-submitted on refresh.
 */
export async function POST(req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> {
  const driver = (await ctx.params).driver ?? "";
  if (!knownDriver(driver)) return notFound();

  const params: Record<string, string> = Object.fromEntries(new URL(req.url).searchParams.entries());
  const type = req.headers.get("content-type") ?? "";
  try {
    const raw = (await req.text()).slice(0, MAX_BODY_BYTES);
    if (type.includes("application/json")) {
      const parsed: unknown = raw === "" ? {} : JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string" || typeof v === "number") params[k] = String(v);
        }
      }
    } else {
      for (const [k, v] of new URLSearchParams(raw).entries()) params[k] = v;
    }
  } catch {
    // A malformed body is just an unusable callback: fall through with whatever the query carried,
    // which handleCallback treats as a forged/unknown authority.
  }
  return respond(req, driver, params);
}
