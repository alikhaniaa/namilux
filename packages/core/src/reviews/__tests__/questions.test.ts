import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { faqs, jobs as jobsTable } from "@namilux/db";
import { staffActor } from "../../__tests__/support/fixtures";
import type { Actor } from "../../types";
import { questions } from "../questions";

describe.skipIf(!hasTestDb())("questions", () => {
  let handle: TestDb;
  let actor: Actor;
  let productId: number;
  const BODY = "آیا این کتری با برق ۲۲۰ ولت ایران کار می‌کند؟";

  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function seed(): Promise<void> {
    const s = await seedMinimal(handle.db);
    productId = s.productId;
    actor = await staffActor(handle.db);
  }

  it("identical question from the same phone within 24h is deduped", async () => {
    await seed();
    const a = await questions.ask(handle.db, { body: BODY, productId, phone: "09121234567", ip: "1.2.3.4" });
    const b = await questions.ask(handle.db, { body: BODY, productId, phone: "۰۹۱۲۱۲۳۴۵۶۷", ip: "1.2.3.4" });
    expect(b.id).toBe(a.id);
    const c = await questions.ask(handle.db, { body: `${BODY} (ویرایش)`, productId, phone: "09121234567", ip: "1.2.3.4" });
    expect(c.id).not.toBe(a.id);
    const d = await questions.ask(handle.db, { body: BODY, productId, phone: "09121234568", ip: "1.2.3.4" });
    expect(d.id).not.toBe(a.id);
    expect((await questions.counts(handle.db)).pending).toBe(3);
    const tg = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "telegram.notify" && j.payloadJson["event"] === "question.new");
    expect(tg).toHaveLength(3);
  });

  it("public list excludes pending and hidden", async () => {
    await seed();
    const pending = await questions.ask(handle.db, { body: `${BODY} ۱`, productId, phone: "09121234567", ip: "1.2.3.4" });
    const answered = await questions.ask(handle.db, { body: `${BODY} ۲`, productId, phone: "09121234568", ip: "1.2.3.4" });
    const hidden = await questions.ask(handle.db, { body: `${BODY} ۳`, productId, phone: "09121234569", ip: "1.2.3.4" });
    await questions.answer(handle.db, answered.id, "بله، دوشاخهٔ استاندارد ایران دارد.", actor, { sendSms: false });
    await questions.answer(handle.db, hidden.id, "پاسخ", actor, { sendSms: false });
    await questions.hide(handle.db, hidden.id, actor);
    const pub = await questions.listForProduct(handle.db, productId);
    expect(pub.items.map((q) => q.id)).toEqual([answered.id]);
    expect(pub.items[0]?.answer).toContain("دوشاخه");
    const admin = await questions.listAdmin(handle.db, { kind: "question" });
    expect(admin.total).toBe(3);
    expect(admin.items.every((q) => typeof q.productName === "string" || q.productName === null)).toBe(true);
    expect((await questions.listAdmin(handle.db, { status: "pending" })).items.map((q) => q.id)).toEqual([pending.id]);
  });

  it("promoteToFaq creates the product faq row", async () => {
    await seed();
    const q = await questions.ask(handle.db, { body: BODY, productId, phone: "09121234567", ip: "1.2.3.4" });
    await questions.answer(handle.db, q.id, "بله، مخصوص برق ۲۲۰ ولت ساخته شده است.", actor, { sendSms: false, promoteToFaq: true });
    const rows = await handle.db.select().from(faqs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.groupKey).toBe(`product:${String(productId)}`);
    expect(rows[0]?.question).toContain("کتری");
    expect(rows[0]?.answerHtml).toContain("۲۲۰");
  });

  it("answer with sendSms enqueues the sms job", async () => {
    await seed();
    const q = await questions.ask(handle.db, { body: BODY, productId, phone: "09121234567", ip: "1.2.3.4" });
    await questions.answer(handle.db, q.id, "بله.", actor, { sendSms: true });
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["questionId"] === q.id);
    expect(sms).toHaveLength(1);
    expect(sms[0]?.payloadJson["phone"]).toBe("09121234567");
    expect(sms[0]?.uniqueKey).toBe(`sms:q:${q.id}`);
    // answering again does not queue a second SMS for the same question
    await questions.answer(handle.db, q.id, "بله، حتماً.", actor, { sendSms: true });
    expect((await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["questionId"] === q.id)).toHaveLength(1);
  });
});
