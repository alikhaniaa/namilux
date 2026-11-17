/**
 * Sales channels - the two storefront instances that run the SAME code, database and catalogue.
 *
 * "main"        namilux.ir - the fixed price, card payment (ZarinPal), SEO.
 * "instalments" the second domain - the derived (higher) price, instalment payment (SnappPay),
 *               no SEO. SnappPay takes a commission from the merchant, so the price shown there is
 *               `pricing/instalments.resolveInstalmentPrice`, never the fixed one.
 *
 * Everything else is shared: products, stock, customers, orders, admin, worker. A channel decides
 * exactly two things - which price is quoted and which gateway may take the money - so it is a
 * server-side fact (the site instance), never a value a client may choose.
 */
export const SALES_CHANNELS = ["main", "instalments"] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

/**
 * The one gateway each channel is allowed to settle through. `placeOrder` refuses any other method
 * (except under `PAYMENT_DRIVER=mock`, the dev/staging simulator), so a quote signed for one site
 * can never be paid on the other's gateway.
 */
export const GATEWAY_FOR_CHANNEL: Record<SalesChannel, "zarinpal" | "snapppay"> = {
  main: "zarinpal",
  instalments: "snapppay",
};

export function isSalesChannel(value: unknown): value is SalesChannel {
  return typeof value === "string" && (SALES_CHANNELS as readonly string[]).includes(value);
}

/** The main storefront's canonical host (constants.CANONICAL_ORIGIN, without the scheme). */
export const MAIN_SITE_HOST = "namilux.ir";

// An absolute or protocol-relative URL on the main host: https://namilux.ir/…, //www.namilux.ir.
const MAIN_SITE_URL_RE = /(?:https?:)?\/\/(?:www\.)?namilux\.ir(?![\w-])/giu;
// Every other mention of the host: running text, an address (info@namilux.ir), a subdomain
// (admin.namilux.ir), a handle (instagram.com/namilux.ir, and the second account «namilux.ir2»). Not a
// longer word that merely contains it (mynamilux.ir, namilux.iran).
const MAIN_SITE_HOST_RE = /(?<![\w-])(?:www\.)?namilux\.ir2?(?![\w-])/giu;

/**
 * Content is written once, for namilux.ir, and both storefronts render it: legacy product
 * descriptions link to `https://namilux.ir/brand/…`, and the terms page says purchases happen only
 * «از طریق سایت namilux.ir». The instalment site must never print the main site's address, so it
 * passes what it renders through this: an absolute URL on the main host moves to `origin` (the same
 * paths exist on both sites), and every other mention of the main host (a handle, an address, a
 * subdomain) becomes `origin`'s host. Two handles that end up the same («namilux.ir2 و namilux.ir») are
 * printed once. The instalment site must read as a site of its own; the main site never calls this.
 */
export function replaceMainSite(text: string, origin: string): string {
  const base = origin.replace(/\/+$/u, "");
  const host = base.replace(/^https?:\/\//u, "");
  const replaced = text.replace(MAIN_SITE_URL_RE, base);
  // An origin under namilux.ir itself would match the host rule again; only its URLs move.
  if (/(^|\.)namilux\.ir(:\d+)?$/iu.test(host)) return replaced;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const repeated = new RegExp(`(${escaped})(?:\\s*(?:و|،|,|/)\\s*${escaped})+`, "gu");
  return replaced.replace(MAIN_SITE_HOST_RE, host).replace(repeated, "$1");
}

/**
 * `replaceMainSite` over every string inside a loader's result: plain objects and arrays are copied
 * with their strings rewritten, and anything else (numbers, dates, null) is kept as it is. A server
 * component can hand content to a client component as a prop, and that prop is serialised into the
 * page's data as it was loaded, so the instalment site cleans the data itself rather than only what
 * RichHtml renders.
 */
export function replaceMainSiteDeep<T>(value: T, origin: string): T {
  if (typeof value === "string") return replaceMainSite(value, origin) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => replaceMainSiteDeep(v, origin)) as T;
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceMainSiteDeep(v, origin);
    return out as T;
  }
  return value;
}
