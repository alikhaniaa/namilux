import { type Db, and, customers, desc, eq, questions } from "@namilux/db";
import { appError } from "../errors";
import { ulid } from "../ids";
import { jobs } from "../jobs";
import { maskPhone, normalizePhone } from "../persian";
import { ensureCustomerForPhone } from "../customers/service";
import type { Actor, Paged, Question } from "../types";
import type { ContactInput, NewsletterInput } from "../validation/requests";
import type { SalesChannel } from "../channel";

function mapQuestion(r: typeof questions.$inferSelect): Question {
  return {
    id: r.id,
    productId: r.productId,
    customerId: r.customerId,
    phoneMasked: maskPhone(r.phone),
    kind: r.kind,
    body: r.body,
    answer: r.answer,
    status: r.status,
    answeredByStaffId: r.answeredByStaffId,
    channel: r.channel,
    createdAt: r.createdAt.toISOString(),
    answeredAt: r.answeredAt === null ? null : r.answeredAt.toISOString(),
  };
}

export const contact = {
  async submit(db: Db, input: ContactInput & { ip: string; customerId?: string | null; channel?: SalesChannel }): Promise<{ id: string }> {
    const phone = normalizePhone(input.phone);
    if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
    const id = ulid();
    await db.insert(questions).values({
      id,
      kind: "contact",
      productId: null,
      customerId: input.customerId ?? null,
      phone,
      body: `${input.name}\n${input.message}`,
      status: "pending",
      channel: input.channel ?? "main",
    });
    await jobs.enqueue(db, "telegram.notify", { event: "contact.message", questionId: id }, { uniqueKey: `tg:contact:${id}` });
    return { id };
  },

  async list(db: Db, q: { status?: "pending" | "answered"; page?: number }): Promise<Paged<Question>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = 50;
    const conds = [eq(questions.kind, "contact")];
    if (q.status !== undefined) conds.push(eq(questions.status, q.status === "answered" ? "answered" : "pending"));
    const rows = await db
      .select()
      .from(questions)
      .where(and(...conds))
      .orderBy(desc(questions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const items = rows.map(mapQuestion);
    return { items, total: items.length, page, pageSize };
  },

  async answer(db: Db, id: string, answer: string, actor: Actor, opts: { sendSms: boolean }): Promise<void> {
    const rows = await db.select().from(questions).where(eq(questions.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) throw appError("NOT_FOUND", { fa: "پیام پیدا نشد" });
    await db
      .update(questions)
      .set({ status: "answered", answer, answeredByStaffId: actor.id, answeredAt: new Date() })
      .where(eq(questions.id, id));
    if (opts.sendSms) {
      await jobs.enqueue(db, "sms.send", { template: "contact.reply", questionId: id, phone: row.phone }, { uniqueKey: `sms:contact:${id}` });
    }
    await jobs.enqueue(db, "telegram.notify", { event: "contact.answered", questionId: id }, { uniqueKey: `tg:contact.a:${id}` });
  },
};

export const newsletter = {
  async subscribe(db: Db, input: NewsletterInput & { ip: string; customerId?: string | null }): Promise<{ status: "subscribed" | "already" }> {
    const phone = normalizePhone(input.phone);
    if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
    const { customer } = await ensureCustomerForPhone(db, phone, { referralCode: null });
    if (customer.marketingOptIn) return { status: "already" };
    await db.update(customers).set({ marketingOptIn: true }).where(eq(customers.id, customer.id));
    return { status: "subscribed" };
  },

  async unsubscribe(db: Db, phone: string): Promise<void> {
    const normalized = normalizePhone(phone);
    if (normalized === null) return;
    await db.update(customers).set({ marketingOptIn: false }).where(eq(customers.phone, normalized));
  },

  async *exportRows(db: Db): AsyncIterable<{ phone: string; since: string }> {
    const rows = await db
      .select({ phone: customers.phone, since: customers.createdAt })
      .from(customers)
      .where(eq(customers.marketingOptIn, true))
      .orderBy(desc(customers.createdAt));
    for (const r of rows) yield { phone: r.phone, since: r.since.toISOString() };
  },
};
