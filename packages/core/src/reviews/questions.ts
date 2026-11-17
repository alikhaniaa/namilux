import { type Db, and, desc, eq, inArray, products, questions as questionsTable, sql } from "@namilux/db";
import type { QuestionKind, QuestionStatus } from "../constants";
import { appError } from "../errors";
import { ulid } from "../ids";
import { jobs } from "../jobs";
import { audit } from "../audit";
import { maskPhone, normalizePhone } from "../persian";
import { promoteQuestion } from "../content/faq";
import type { Actor, Paged, Question } from "../types";
import type { QuestionInput } from "../validation/requests";
import type { SalesChannel } from "../channel";

function mapQuestion(r: typeof questionsTable.$inferSelect): Question {
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

export const questions = {
  async ask(db: Db, input: QuestionInput & { productId: number; customerId?: string | null; phone: string; ip: string; channel?: SalesChannel }): Promise<{ id: string }> {
    const phone = normalizePhone(input.phone);
    if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
    const dupe = await db
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(and(eq(questionsTable.kind, "question"), eq(questionsTable.phone, phone), eq(questionsTable.body, input.body), sql`${questionsTable.createdAt} > now() - interval '24 hours'`))
      .limit(1);
    if (dupe[0] !== undefined) return { id: dupe[0].id };
    const id = ulid();
    await db.insert(questionsTable).values({ id, kind: "question", productId: input.productId, customerId: input.customerId ?? null, phone, body: input.body, status: "pending", channel: input.channel ?? "main" });
    await jobs.enqueue(db, "telegram.notify", { event: "question.new", questionId: id, productId: input.productId }, { uniqueKey: `tg:q:${id}` });
    return { id };
  },

  async answer(db: Db, id: string, answer: string, actor: Actor, opts: { sendSms: boolean; promoteToFaq?: boolean }): Promise<void> {
    const rows = await db.select().from(questionsTable).where(eq(questionsTable.id, id)).limit(1);
    const row = rows[0];
    if (row === undefined) throw appError("NOT_FOUND", { fa: "پرسش پیدا نشد" });
    await db.update(questionsTable).set({ status: "answered", answer, answeredByStaffId: actor.id, answeredAt: new Date() }).where(eq(questionsTable.id, id));
    if (opts.promoteToFaq === true) await promoteQuestion(db, id, actor);
    // DECISION: SMS_TEMPLATES (the spec, frozen) has no Q&A entry; the reply reuses "concierge.reply"
    // («پاسخ شما آماده است» + the product link) so the worker renders a DECIDED template.
    if (opts.sendSms) await jobs.enqueue(db, "sms.send", { template: "concierge.reply", questionId: id, phone: row.phone }, { uniqueKey: `sms:q:${id}` });
    await audit.log(db, actor, "question.answer", "questions", id, null, { promoteToFaq: opts.promoteToFaq === true });
  },

  async hide(db: Db, id: string, actor: Actor): Promise<void> {
    await db.update(questionsTable).set({ status: "hidden" }).where(eq(questionsTable.id, id));
    await audit.log(db, actor, "question.hide", "questions", id, null, null);
  },

  async listForProduct(db: Db, productId: number, page = 1): Promise<Paged<Question>> {
    const pageSize = 10;
    const rows = await db
      .select()
      .from(questionsTable)
      .where(and(eq(questionsTable.kind, "question"), eq(questionsTable.productId, productId), eq(questionsTable.status, "answered")))
      .orderBy(desc(questionsTable.createdAt))
      .limit(pageSize)
      .offset((Math.max(1, page) - 1) * pageSize);
    const items = rows.map(mapQuestion);
    return { items, total: items.length, page: Math.max(1, page), pageSize };
  },

  async listAdmin(db: Db, q: { status?: QuestionStatus; kind?: QuestionKind; page?: number }): Promise<Paged<Question & { productName: string | null }>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = 50;
    const conds = [eq(questionsTable.kind, q.kind ?? "question")];
    if (q.status !== undefined) conds.push(inArray(questionsTable.status, [q.status]));
    const rows = await db
      .select()
      .from(questionsTable)
      .leftJoin(products, eq(products.id, questionsTable.productId))
      .where(and(...conds))
      .orderBy(desc(questionsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const items = rows.map((r) => ({ ...mapQuestion(r.questions), productName: r.products?.displayName ?? null }));
    return { items, total: items.length, page, pageSize };
  },

  async counts(db: Db): Promise<{ pending: number }> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questionsTable)
      .where(and(eq(questionsTable.kind, "question"), eq(questionsTable.status, "pending")));
    return { pending: Number(row?.n ?? 0) };
  },
};
