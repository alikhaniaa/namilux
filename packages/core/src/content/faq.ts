import { and, asc, eq, faqs as faqsTable, max, pages, questions } from "@namilux/db";
import type { Db } from "@namilux/db";
import type { Actor } from "../types";
import { appError } from "../errors";
import { audit } from "../audit";
import { faZwnj } from "../persian";
import { htmlToText, sanitizeHtml } from "../html";
// DECISION: `../cache/invalidation` (dependency list) declares no `tagsForFaqChange` and every one of its
// exports was not yet built when this was written; the rules line spells the tag set out literally, so it is composed
// from `../cache/tags` (DONE) - the same primitives `tagsFor*Change` will use when it lands.
import { tags } from "../cache/tags";

export type FaqItem = {
  id: number;
  group: string;
  question: string;
  answerHtml: string;
  answerText: string;
  sort: number;
};

// DECISION (M0 step 3): FaqInput is declared once in ../types (z.infer'd from
// ../validation/content.faqSchema and re-exported by types/content.ts). Its field is `groupKey`
// (the column name), not the header's `group`; `FaqItem.group` keeps the header's read-side name.
import type { FaqInput } from "../types";

export type { FaqInput };

export const FAQ_GROUP_RE = /^[a-z][a-z0-9_:-]{1,60}$/;

export const FAQ_GROUPS_SUGGESTED: readonly string[] = [
  "general",
  "shipping",
  "returns",
  "warranty",
  "payment",
  "installments",
];

export const PDP_ACCORDION_GROUPS: Readonly<Record<"shippingReturns" | "warranty", readonly string[]>> = {
  shippingReturns: ["shipping", "returns"],
  warranty: ["warranty"],
};

/** rules: question ≤ 300 chars (mirrors validation/content.faqSchema `zText(300, 3)`). */
const QUESTION_MAX = 300;
/** validation/content.faqSchema `htmlField(20_000)` - the same ceiling, re-checked at the service. */
const ANSWER_HTML_MAX = 20_000;
/** `sort` is an ordering hint; validation/common.zSort caps it at 100 000. */
const SORT_MAX = 100_000;

/** The prefix that makes a group product-scoped (`product:1044`). */
const PRODUCT_GROUP_PREFIX = "product:";

// ---------------------------------------------------------------- pure helpers

/**
 * DECISION: `productFaqGroup` guards its input instead of interpolating whatever it is handed. The
 * result becomes both a stored group key and a cache-tag component, so `product:NaN` / `product:-1`
 * must never reach either; the header is silent and rejecting is the more secure reading.
 */
export function productFaqGroup(productId: number): string {
  if (!Number.isSafeInteger(productId) || productId < 1) {
    throw appError("VALIDATION", { details: { field: "productId", reason: "not_a_product_id" } });
  }
  return `${PRODUCT_GROUP_PREFIX}${productId}`;
}

/** `product:1044` → 1044; anything else → null. */
function productIdOfGroup(group: string): number | null {
  if (!group.startsWith(PRODUCT_GROUP_PREFIX)) return null;
  const rest = group.slice(PRODUCT_GROUP_PREFIX.length);
  if (!/^[0-9]{1,10}$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

/** Suggested groups first in their listed order, then every other group alphabetically. */
function groupRank(group: string): number {
  const at = FAQ_GROUPS_SUGGESTED.indexOf(group);
  return at === -1 ? FAQ_GROUPS_SUGGESTED.length : at;
}

function compareGroups(a: string, b: string): number {
  const byRank = groupRank(a) - groupRank(b);
  if (byRank !== 0) return byRank;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

type FaqRow = { id: number; groupKey: string; question: string; answerHtml: string; sort: number };

const toFaqItem = (row: FaqRow): FaqItem => ({
  id: row.id,
  group: row.groupKey,
  question: row.question,
  answerHtml: row.answerHtml,
  // rules: seo/jsonld.faq publishes `acceptedAnswer.text` - plain text, never markup.
  answerText: htmlToText(row.answerHtml),
  sort: row.sort,
});

/** The five characters that can break out of a text node or an attribute value. */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

// ---------------------------------------------------------------- write-side normalisation

function normalizeGroup(raw: string): string {
  const group = typeof raw === "string" ? raw.trim() : "";
  if (!FAQ_GROUP_RE.test(group)) {
    throw appError("VALIDATION", { details: { field: "groupKey", reason: "bad_group_key" } });
  }
  return group;
}

/**
 * rules: «question → faZwnj, trimmed, ≤ 300 chars, no HTML (escaped at render)». The text is stored
 * verbatim (minus ZWNJ normalisation): it is a text node at render, so the renderer escapes it.
 * DECISION: it is deliberately NOT pushed through htmlToText, which would eat a legitimate
 * "a < b" comparison inside a question; escaping at render is what the rules line asks for.
 */
function normalizeQuestion(raw: string): string {
  const question = faZwnj(typeof raw === "string" ? raw.trim() : "");
  if (question === "") {
    throw appError("VALIDATION", { details: { field: "question", reason: "required" } });
  }
  if (question.length > QUESTION_MAX) {
    throw appError("VALIDATION", { details: { field: "question", reason: "too_long" } });
  }
  return question;
}

function normalizeAnswerHtml(raw: string): string {
  const input = typeof raw === "string" ? raw : "";
  if (input.length > ANSWER_HTML_MAX) {
    throw appError("VALIDATION", { details: { field: "answerHtml", reason: "too_long" } });
  }
  // rules: no images inside an answer - an accordion answer is prose; the spec's image whitelist
  // exists for editorial bodies.
  const html = sanitizeHtml(input, { allowImages: false });
  if (htmlToText(html) === "") {
    throw appError("VALIDATION", { details: { field: "answerHtml", reason: "required" } });
  }
  return html;
}

function normalizeSort(raw: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(SORT_MAX, Math.max(0, Math.trunc(raw)));
}

async function faqPageSlug(db: Db): Promise<string | null> {
  const rows = await db
    .select({ slug: pages.slug })
    .from(pages)
    .where(and(eq(pages.template, "faq"), eq(pages.status, "published")))
    .orderBy(asc(pages.id))
    .limit(1);
  return rows[0]?.slug ?? null;
}

/**
 * rules: «tags: content + page(faq page slug) + (product(id) when group is product-scoped)».
 * The FAQ page's slug is data (`pages.template = 'faq'`), not a constant, so it is looked up; a site
 * without a published FAQ page simply contributes no page tag.
 */
async function tagsForFaq(db: Db, group: string): Promise<string[]> {
  const out: string[] = [tags.content];
  const slug = await faqPageSlug(db);
  if (slug !== null) out.push(tags.page(slug));
  const productId = productIdOfGroup(group);
  if (productId !== null) out.push(tags.product(productId));
  return out;
}

// ---------------------------------------------------------------- read

export async function getFaqs(db: Db, group?: string): Promise<FaqItem[]> {
  // DECISION: a read never throws on a malformed group - a key that cannot exist simply matches no
  // row, which is what the storefront wants (an empty accordion, not a 500). FAQ_GROUP_RE is
  // enforced on the WRITE side, where a bad key would become permanent.
  const wanted = typeof group === "string" ? group.trim() : undefined;
  if (wanted === "") return [];

  const rows = await db
    .select({
      id: faqsTable.id,
      groupKey: faqsTable.groupKey,
      question: faqsTable.question,
      answerHtml: faqsTable.answerHtml,
      sort: faqsTable.sort,
    })
    .from(faqsTable)
    .where(
      wanted === undefined
        ? eq(faqsTable.isActive, true)
        : and(eq(faqsTable.isActive, true), eq(faqsTable.groupKey, wanted)),
    )
    .orderBy(asc(faqsTable.sort), asc(faqsTable.id));

  // Array#sort is stable, so the (sort, id) order survives inside each group.
  return rows.sort((a, b) => compareGroups(a.groupKey, b.groupKey)).map(toFaqItem);
}

// ---------------------------------------------------------------- write

export async function upsertFaq(
  db: Db,
  input: FaqInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const group = normalizeGroup(input.groupKey);
  const question = normalizeQuestion(input.question);
  const answerHtml = normalizeAnswerHtml(input.answerHtml);
  const sort = normalizeSort(input.sort);
  const isActive = input.isActive !== false;

  const values = { groupKey: group, question, answerHtml, sort, isActive };

  if (input.id === undefined) {
    const inserted = await db.insert(faqsTable).values(values).returning({ id: faqsTable.id });
    const row = inserted[0];
    if (row === undefined) throw appError("INTERNAL", { details: { reason: "faq_insert_failed" } });
    await audit.log(db, actor, "faq.create", "faq", String(row.id), undefined, values);
    return { id: row.id, tags: await tagsForFaq(db, group) };
  }

  const before = await db
    .select({
      id: faqsTable.id,
      groupKey: faqsTable.groupKey,
      question: faqsTable.question,
      answerHtml: faqsTable.answerHtml,
      sort: faqsTable.sort,
      isActive: faqsTable.isActive,
    })
    .from(faqsTable)
    .where(eq(faqsTable.id, input.id))
    .limit(1);
  const previous = before[0];
  if (previous === undefined) {
    throw appError("NOT_FOUND", { details: { entity: "faq", id: input.id } });
  }

  await db
    .update(faqsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(faqsTable.id, input.id));
  await audit.log(db, actor, "faq.update", "faq", String(input.id), previous, values);

  // Moving an item between groups also invalidates the group it left.
  const changed = new Set(await tagsForFaq(db, group));
  if (previous.groupKey !== group) {
    for (const tag of await tagsForFaq(db, previous.groupKey)) changed.add(tag);
  }
  return { id: input.id, tags: [...changed].sort() };
}

export async function promoteQuestion(
  db: Db,
  questionId: string,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  const id = typeof questionId === "string" ? questionId.trim() : "";
  if (id === "") {
    throw appError("VALIDATION", { details: { field: "questionId", reason: "required" } });
  }

  const found = await db
    .select({
      id: questions.id,
      kind: questions.kind,
      productId: questions.productId,
      body: questions.body,
      answer: questions.answer,
      status: questions.status,
    })
    .from(questions)
    .where(eq(questions.id, id))
    .limit(1);
  const question = found[0];
  if (question === undefined) {
    throw appError("NOT_FOUND", { details: { entity: "question", id } });
  }

  const answer = (question.answer ?? "").trim();
  if (question.status !== "answered" || answer === "") {
    throw appError("VALIDATION", { details: { field: "answer", reason: "question_not_answered" } });
  }
  if (question.productId === null) {
    throw appError("VALIDATION", { details: { field: "productId", reason: "not_product_scoped" } });
  }

  const group = productFaqGroup(question.productId);
  const promoted = normalizeQuestion(question.body);
  // `questions.answer` is plain text: escaped into one paragraph, then run through the same
  // sanitizer as any other answer so the column only ever holds sanitizer output.
  const answerHtml = normalizeAnswerHtml(`<p>${escapeHtml(answer)}</p>`);

  // EDGE CASE: promoting twice is a no-op - the same question text in the same group is one row.
  const existing = await db
    .select({ id: faqsTable.id })
    .from(faqsTable)
    .where(and(eq(faqsTable.groupKey, group), eq(faqsTable.question, promoted)))
    .limit(1);
  const already = existing[0];
  if (already !== undefined) {
    return { id: already.id, tags: await tagsForFaq(db, group) };
  }

  const last = await db
    .select({ value: max(faqsTable.sort) })
    .from(faqsTable)
    .where(eq(faqsTable.groupKey, group));
  const sort = normalizeSort((last[0]?.value ?? 0) + 1);

  const inserted = await db
    .insert(faqsTable)
    .values({ groupKey: group, question: promoted, answerHtml, sort, isActive: true })
    .returning({ id: faqsTable.id });
  const row = inserted[0];
  if (row === undefined) throw appError("INTERNAL", { details: { reason: "faq_insert_failed" } });

  await audit.log(
    db,
    actor,
    "faq.promote",
    "faq",
    String(row.id),
    { questionId: id },
    { groupKey: group, question: promoted, sort },
  );
  return { id: row.id, tags: await tagsForFaq(db, group) };
}
