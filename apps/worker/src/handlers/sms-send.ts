import { createHash } from "node:crypto";
import { ROUTES, absUrl, analytics, jobs, maskPhone, normalizePhone, ordersRepo, ulid } from "@namilux/core";
import { and, eq, gte, products, questions, smsLog, sql } from "@namilux/db";
import { SITE_VAR, namesSite, renderTemplate, sitePatternKey } from "@namilux/integrations";
import type { SmsTemplate } from "@namilux/core/constants";
import type { Handler } from "../runtime";

type Vars = Record<string, string | number>;

function toHash(phone: string, key: string): string {
  return createHash("sha256").update(`${phone}${key}`).digest("hex");
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Build the template variables for an order SMS from the order aggregate.
 *
 * No order message carries a link any more. FarazSMS refuses to register a pattern that takes a URL
 * as a variable, so the rebuilt wording (7 Sep 2026) prints fixed addresses instead - {site}/account
 * for payment and {site}/track for tracking - and the only variables left are the ones the pattern
 * declares. `{site}` is not one of them: it is the storefront the order was placed on, and the
 * instalment site's wording is its own pattern (see `siteOf` and `sitePatternKey` below).
 *
 * The order code rides under two different variable names, which is not a mistake. FarazSMS's
 * reviewer treats a pattern variable called `code` as a one-time password and rewrites it to a
 * 6-digit `int`; an order code is `NL-XXXXX`, so placed_pending, expired and cancelled - the three
 * patterns rebuilt after that was understood (7 Sep 2026) - call it `sefaresh` instead and were
 * approved at `str` 10. paid, shipped, delivered and return.received were approved earlier with
 * `code` at 10 and keep it: a declaration that already fits is not worth resubmitting. The names
 * here must match the panel exactly - an attribute the pattern does not declare is rejected outright.
 */
const SEFARESH_TEMPLATES = new Set(["order.placed_pending", "order.expired", "order.cancelled"]);

async function orderVars(db: Parameters<Handler>[0]["db"], template: string, orderId: string): Promise<Vars | null> {
  const order = await ordersRepo.findById(db, orderId);
  if (order === null) return null;
  const code = order.code;
  switch (template) {
    case "order.paid":
      return { code, eta: order.shipping.etaMax };
    case "order.shipped": {
      const shipment = await ordersRepo.shipments.latestFor(db, orderId);
      return { code, carrier: shipment?.carrier ?? "", tracking: shipment?.trackingCode ?? "" };
    }
    // delivered and return.received declare `code` alone; placed_pending, expired and cancelled
    // declare the same value as `sefaresh`. `url` and the free-form `note` FarazSMS would not approve.
    default:
      return SEFARESH_TEMPLATES.has(template) ? { sefaresh: code } : { code };
  }
}

/**
 * Everything that is not an order. These used to fall through to "no vars to render; skipping" - 
 * `concierge.reply`, `contact.reply`, `loyalty.tier_up` and `birthday.coupon` were enqueued with
 * their own identifiers rather than with `vars`, so the message was built and then silently dropped.
 */
async function otherVars(
  db: Parameters<Handler>[0]["db"],
  template: string,
  payload: { questionId?: string; tier?: string; benefits?: string },
  origin: string,
): Promise<Vars | null> {
  switch (template) {
    case "concierge.reply":
    case "contact.reply": {
      const id = payload.questionId;
      if (typeof id !== "string") return null;
      const rows = await db
        .select({ answer: questions.answer, name: products.name })
        .from(questions)
        .leftJoin(products, eq(products.id, questions.productId))
        .where(eq(questions.id, id))
        .limit(1);
      const row = rows[0];
      // An unanswered question has nothing to tell the shopper; sending an empty reply is worse
      // than sending nothing, so it is dropped rather than rendered blank. The answer is still read
      // here even though concierge.reply no longer sends it - it is what proves there IS a reply.
      if (row === undefined || row.answer === null || row.answer === "") return null;
      if (template === "contact.reply") return { answer: row.answer };
      // DIy15ksqcV declares `name` alone. FarazSMS caps a str variable at 25 characters, so an
      // `answer` variable could only ever carry a stub; the SMS names the product and points at
      // {site}/account, where the درخواست‌ها tab already shows the reply in full.
      return { name: row.name ?? "نامی‌لوکس" };
    }
    case "loyalty.tier_up":
      return typeof payload.tier === "string" ? { tier: payload.tier, benefits: payload.benefits ?? "" } : null;
    // Never registered as a pattern - FarazSMS reads a birthday gift as advertising - so this one
    // goes out as free text and may still carry a link.
    case "birthday.coupon":
      return { url: absUrl(origin, ROUTES.account) };
    // 95DOACyydm declares no variables at all. An empty map is NOT "nothing to render": it is what
    // makes the driver take the instant pattern route instead of the moderated free-text one.
    case "customer.welcome":
      return {};
    default:
      return null;
  }
}

function siteOf(env: { SITE_ORIGIN?: string | undefined }): string | null {
  const origin = env.SITE_ORIGIN;
  if (origin === undefined || origin === "") return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

const ORDER_TEMPLATES = new Set<string>([
  "order.paid",
  "order.shipped",
  "order.delivered",
  "order.expired",
  "order.placed_pending",
  "order.cancelled",
  "return.received",
]);

export const smsSend: Handler = async ({ db, drivers, env, log, job }) => {
  const p = job.payload as { template?: string; phone?: string; orderId?: string; vars?: Vars; questionId?: string; tier?: string; benefits?: string; channel?: string };
  const template = p.template as SmsTemplate | undefined;
  const rawPhone = typeof p.phone === "string" ? normalizePhone(p.phone) : null;
  if (template === undefined || rawPhone === null) {
    log.warn({ jobId: job.id }, "sms-send: missing template or phone");
    return; // malformed payload → complete (a retry cannot fix it)
  }
  if (template === "otp") return; // OTPs are sent synchronously by core auth, never here.

  const origin = (env.SITE_ORIGIN) ?? "";
  const orderId = typeof p.orderId === "string" ? p.orderId : null;

  // Idempotency: if this order SMS was already sent, do not resend after a crash-and-retry.
  if (orderId !== null && ORDER_TEMPLATES.has(template)) {
    const already = await db
      .select({ id: smsLog.id })
      .from(smsLog)
      .where(and(eq(smsLog.orderId, orderId), eq(smsLog.template, template), eq(smsLog.status, "sent")))
      .limit(1);
    if (already[0] !== undefined) {
      log.info({ template, outcome: "already-sent" }, "sms-send skipped (idempotent)");
      return;
    }
  }

  // Resolve the message text.
  let vars: Vars | null = p.vars ?? null;
  if (vars === null && orderId !== null) vars = await orderVars(db, template, orderId);
  if (vars === null) vars = await otherVars(db, template, p, origin);
  if (vars === null) {
    log.warn({ template }, "sms-send: no vars to render; skipping");
    return;
  }

  // A message that prints the shop's address prints the address of ITS storefront, and on the
  // instalment site it goes by that site's own pattern. `site` fills the text only: it is never sent
  // as a pattern attribute, which FarazSMS would reject as undeclared.
  let site: Vars = {};
  let patternKey: ReturnType<typeof sitePatternKey> = template;
  if (namesSite(template)) {
    const host = siteOf(env);
    if (host === null) {
      log.warn({ template }, "sms-send: the storefront has no origin in this environment; skipping");
      return;
    }
    site = { [SITE_VAR]: host };
    patternKey = sitePatternKey(template, "main");
  }
  const { text } = renderTemplate(template, { ...vars, ...site });
  if (text === "") {
    log.warn({ template }, "sms-send: template rendered empty; skipping");
    return;
  }

  const pepper = (env.INTERNAL_SIGNING_KEY) ?? "";
  const budget = Number(env.SMS_DAILY_BUDGET_TOMAN ?? 0);

  // Daily budget: sum today's logged cost. A non-transactional read is fine - a small overshoot is
  // acceptable and the cap is a floodgate, not an accountant.
  if (budget > 0) {
    const spent = await db
      .select({ total: sql<string | number | null>`coalesce(sum(${smsLog.cost}), 0)` })
      .from(smsLog)
      .where(gte(smsLog.createdAt, startOfTodayUtc()));
    const used = Number(spent[0]?.total ?? 0);
    if (used >= budget) {
      await db.insert(smsLog).values({
        id: ulid(),
        toMasked: maskPhone(rawPhone),
        toHash: toHash(rawPhone, pepper),
        template,
        provider: drivers.sms.key,
        status: "failed",
        error: "budget",
        ...(orderId !== null ? { orderId } : {}),
      });
      const day = startOfTodayUtc().toISOString().slice(0, 10);
      await jobs.enqueue(db, "telegram.notify", { kind: "security.alert", event: "sms.budget", count: used }, { uniqueKey: `sms.budget:${day}` });
      log.warn({ used, budget }, "sms budget exceeded; message dropped");
      return; // complete: retrying will not put us back under budget today.
    }
  }

  // template + vars ride along with the text: FarazSMS sends a *pattern* by name and fills its
  // variables, and would otherwise be stuck with the moderated free-text route. `patternKey` only
  // travels when it differs from the template (an instalment-site wording).
  const result = await drivers.sms.send(rawPhone, text, {
    template,
    vars,
    ...(patternKey !== template ? { patternKey } : {}),
    ...(orderId !== null ? { ref: orderId } : {}),
  });
  await db.insert(smsLog).values({
    id: ulid(),
    toMasked: maskPhone(rawPhone),
    toHash: toHash(rawPhone, pepper),
    template,
    provider: drivers.sms.key,
    status: result.ok ? "sent" : "failed",
    ...(result.ok ? { providerRef: result.providerRef, cost: result.costToman } : { error: result.error }),
    ...(orderId !== null ? { orderId } : {}),
  });

  if (!result.ok) {
    // A retryable provider failure should retry; a permanent one should not churn.
    if (result.retryable) throw new Error(`sms provider failed: ${result.error}`);
    log.warn({ template, error: result.error }, "sms-send: non-retryable provider failure");
    return;
  }
  // Best-effort analytics (P1 recorder); a failure here must never fail the send.
  try {
    await analytics.recordServer(db, "sms_sent", { template });
  } catch {
    /* analytics is P1; ignore until implemented */
  }
  log.info({ template, outcome: "sent" }, "sms sent");
};
