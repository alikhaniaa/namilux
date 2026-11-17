import { type Db, and, desc, eq, getTableColumns, inArray, products, questions, sql } from "@namilux/db";
import { audit } from "../audit";
import { appError } from "../errors";
import { ulid } from "../ids";
import { jobs } from "../jobs";
import { maskPhone, normalizePhone } from "../persian";
import type { Actor, ConciergeQuery, ConciergeRequest, Paged } from "../types";
import type { ConciergeInput } from "../validation/requests";
import type { SalesChannel } from "../channel";

export function whatsappPrefill(p: { displayName: string; sku: string | null; url: string }): string {
  const code = p.sku !== null && p.sku !== "" ? ` (کد ${p.sku})` : "";
  return `سلام، قیمت و موجودی «${p.displayName}»${code} را می‌خواهم. ${p.url}`;
}

function mapConcierge(r: typeof questions.$inferSelect, product: { slug: string; displayName: string } | null): ConciergeRequest {
  return {
    id: r.id,
    productId: r.productId,
    customerId: r.customerId,
    phoneMasked: maskPhone(r.phone),
    kind: "price",
    body: r.body,
    answer: r.answer,
    status: r.status,
    answeredByStaffId: r.answeredByStaffId,
    createdAt: r.createdAt.toISOString(),
    answeredAt: r.answeredAt === null ? null : r.answeredAt.toISOString(),
    channel: r.channel,
    phone: r.phone,
    productSlug: product?.slug ?? "",
    productName: product?.displayName ?? "",
  };
}

export const concierge = {
  async request(db: Db, input: ConciergeInput & { customerId?: string | null; ip: string; channel?: SalesChannel }): Promise<{ id: string }> {
    const channel = input.channel ?? "main";
    const phone = normalizePhone(input.phone);
    if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
    // Dedupe the same phone+product within 24 h (no new Telegram ping).
    const existing = await db
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(
          eq(questions.kind, "price"),
          eq(questions.phone, phone),
          eq(questions.productId, input.productId),
          // per storefront: the two sites quote different prices, so each request gets its own answer
          eq(questions.channel, channel),
          sql`${questions.createdAt} > now() - interval '24 hours'`,
        ),
      )
      .limit(1);
    if (existing[0] !== undefined) return { id: existing[0].id };

    const id = ulid();
    await db.insert(questions).values({
      id,
      kind: "price",
      productId: input.productId,
      customerId: input.customerId ?? null,
      phone,
      body: input.note ?? "",
      status: "pending",
      channel,
    });
    await jobs.enqueue(db, "telegram.notify", { event: "concierge.request", questionId: id, productId: input.productId }, { uniqueKey: `tg:concierge:${id}` });
    return { id };
  },

  async list(db: Db, q: ConciergeQuery): Promise<Paged<ConciergeRequest>> {
    const page = Math.max(1, q.page);
    const pageSize = q.pageSize;
    const conds = [eq(questions.kind, "price")];
    if (q.status !== undefined && q.status.length > 0) conds.push(inArray(questions.status, q.status));
    if (q.productId !== undefined) conds.push(eq(questions.productId, q.productId));
    const rows = await db
      .select()
      .from(questions)
      .leftJoin(products, eq(products.id, questions.productId))
      .where(and(...conds))
      .orderBy(desc(questions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const items = rows.map((r) => mapConcierge(r.questions, r.products === null ? null : { slug: r.products.slug, displayName: r.products.displayName }));
    return { items, total: items.length, page, pageSize };
  },

  /** The account «درخواست‌ها» tab: this customer's own price requests, newest first (no paging - a shopper has a handful). */
  async listForCustomer(db: Db, customerId: string, channel?: SalesChannel): Promise<ConciergeRequest[]> {
    const rows = await db
      // nl_web intentionally cannot read products.cost_price. Select only the public product
      // fields this page uses; SELECT * made even an empty requests page fail with 42501.
      .select({ questions: getTableColumns(questions), products: { slug: products.slug, displayName: products.displayName } })
      .from(questions)
      .leftJoin(products, eq(products.id, questions.productId))
      // one storefront's requests only: an answer quotes the price of the site it was asked on
      .where(and(eq(questions.kind, "price"), eq(questions.customerId, customerId), ...(channel === undefined ? [] : [eq(questions.channel, channel)])))
      .orderBy(desc(questions.createdAt))
      .limit(50);
    return rows.map((r) => mapConcierge(r.questions, r.products === null ? null : { slug: r.products.slug, displayName: r.products.displayName }));
  },

  async answer(db: Db, id: string, answer: string, actor: Actor, opts: { sendSms: boolean; publishPrice?: number }): Promise<void> {
    const rows = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
    const q = rows[0];
    if (q === undefined) throw appError("NOT_FOUND", { fa: "درخواست پیدا نشد" });
    // «انتشار قیمت» writes products.price, the MAIN site's fixed price. A request from the instalment
    // site is answered with the instalment price, so publishing that figure would overwrite the cash
    // price with a higher one. Refused before anything is written.
    if (opts.publishPrice !== undefined && q.channel === "instalments") {
      throw appError("VALIDATION", { fa: "این درخواست از سایت اقساطی است؛ قیمت اصلی کالا را از صفحهٔ ویرایش محصول تغییر دهید." });
    }
    await db
      .update(questions)
      .set({ status: "answered", answer, answeredByStaffId: actor.id, answeredAt: new Date() })
      .where(eq(questions.id, id));
    if (opts.publishPrice !== undefined && q.productId !== null) {
      const before = await db.select({ price: products.price }).from(products).where(eq(products.id, q.productId)).limit(1);
      await db.update(products).set({ price: opts.publishPrice }).where(eq(products.id, q.productId));
      await audit.log(db, actor, "product.price.set", "products", String(q.productId), { price: before[0]?.price ?? null }, { price: opts.publishPrice, via: "concierge" });
    }
    if (opts.sendSms) {
      await jobs.enqueue(db, "sms.send", { template: "concierge.reply", questionId: id, phone: q.phone }, { uniqueKey: `sms:concierge:${id}` });
    }
  },

  async assign(db: Db, id: string, staffId: string | null, actor: Actor): Promise<void> {
    await db.update(questions).set({ answeredByStaffId: staffId }).where(eq(questions.id, id));
    await audit.log(db, actor, "concierge.assign", "questions", id, null, { staffId });
  },

  async snooze(db: Db, id: string, until: Date, actor: Actor): Promise<void> {
    // Snooze is recorded as an audit note until the P1 inbox scheduling table lands.
    await audit.log(db, actor, "concierge.snooze", "questions", id, null, { until: until.toISOString() });
  },

  async counts(db: Db): Promise<{ pending: number; snoozed: number; today: number }> {
    const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(questions).where(and(eq(questions.kind, "price"), eq(questions.status, "pending")));
    const [today] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(and(eq(questions.kind, "price"), sql`${questions.createdAt} >= date_trunc('day', now())`));
    return { pending: pending?.n ?? 0, snoozed: 0, today: today?.n ?? 0 };
  },
};
