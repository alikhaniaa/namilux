import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, faqs as faqsTable, pages, questions } from "@namilux/db";
import { createTestDb, hasTestDb, seedMinimal, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

// DECISION: ../../audit is owned by another module and not yet built when this was written (its `log` throws); the mock
// is the documented no-op signature so these stay tests of faq.ts.
vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import {
  FAQ_GROUPS_SUGGESTED,
  FAQ_GROUP_RE,
  PDP_ACCORDION_GROUPS,
  getFaqs,
  productFaqGroup,
  promoteQuestion,
  upsertFaq,
} from "../faq";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import { ulid } from "../../ids";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "staff-test" };

async function expectAppError(promise: Promise<unknown>, code: ErrorCode, reason?: string): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    expect(isAppError(err)).toBe(true);
    if (!isAppError(err)) return;
    expect(err.code).toBe(code);
    if (reason !== undefined) expect(err.details).toMatchObject({ reason });
    return;
  }
  throw new Error(`expected an AppError ${code}`);
}

// ── pure: the group key ────────────────────────────────────────────────────────────────────────

describe("group key regex", () => {
  const valid = [
    "general",
    "shipping",
    "returns",
    "warranty",
    "payment",
    "installments",
    "product:1044",
    "how_to-use",
  ];
  for (const group of valid) {
    it(`accepts ${group}`, () => {
      expect(FAQ_GROUP_RE.test(group)).toBe(true);
    });
  }

  const invalid = [
    ["Shipping", "uppercase"],
    ["1shipping", "leading digit"],
    ["s", "one character"],
    ["", "empty"],
    ["ارسال", "non-Latin"],
    ["ship ping", "space"],
    ["ship/ping", "slash"],
    [`a${"b".repeat(61)}`, "over 61 characters"],
  ] as const;
  for (const [group, why] of invalid) {
    it(`rejects ${why}`, () => {
      expect(FAQ_GROUP_RE.test(group)).toBe(false);
    });
  }

  it("productFaqGroup builds a matching key", () => {
    expect(productFaqGroup(1044)).toBe("product:1044");
    expect(FAQ_GROUP_RE.test(productFaqGroup(1044))).toBe(true);
  });

  it("productFaqGroup refuses anything that is not a product id", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => productFaqGroup(bad)).toThrow();
    }
  });

  it("the suggested groups are all valid keys and the PDP mapping only names them", () => {
    for (const group of FAQ_GROUPS_SUGGESTED) expect(FAQ_GROUP_RE.test(group)).toBe(true);
    expect(PDP_ACCORDION_GROUPS.shippingReturns).toEqual(["shipping", "returns"]);
    expect(PDP_ACCORDION_GROUPS.warranty).toEqual(["warranty"]);
    for (const group of [...PDP_ACCORDION_GROUPS.shippingReturns, ...PDP_ACCORDION_GROUPS.warranty]) {
      expect(FAQ_GROUPS_SUGGESTED).toContain(group);
    }
  });
});

// ── integration ────────────────────────────────────────────────────────────────────────────────

describe.skipIf(!hasTestDb())("faq against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  it("empty product group", async () => {
    await withTestTx(handle.db, async (tx) => {
      expect(await getFaqs(tx, "product:1044")).toEqual([]);
      // a group key that could never exist is an empty accordion, not a 500
      expect(await getFaqs(tx, "Shipping")).toEqual([]);
      expect(await getFaqs(tx, "   ")).toEqual([]);
    });
  });

  it("group ordering", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx.insert(faqsTable).values([
        { groupKey: "zebra", question: "z1", answerHtml: "<p>z</p>", sort: 0 },
        { groupKey: "warranty", question: "w1", answerHtml: "<p>w</p>", sort: 5 },
        { groupKey: "warranty", question: "w0", answerHtml: "<p>w</p>", sort: 1 },
        { groupKey: "general", question: "g1", answerHtml: "<p>g</p>", sort: 0 },
        { groupKey: "alpha", question: "a1", answerHtml: "<p>a</p>", sort: 0 },
        { groupKey: "shipping", question: "s-hidden", answerHtml: "<p>s</p>", sort: 0, isActive: false },
      ]);

      const items = await getFaqs(tx);
      // suggested order first (general … warranty), then every other group alphabetically
      expect(items.map((i) => i.group)).toEqual([
        "general",
        "warranty",
        "warranty",
        "alpha",
        "zebra",
      ]);
      // inside a group: sort, then id
      expect(items.filter((i) => i.group === "warranty").map((i) => i.question)).toEqual(["w0", "w1"]);
      // rules: inactive items never reach the storefront
      expect(items.some((i) => i.question === "s-hidden")).toBe(false);
      expect(await getFaqs(tx, "shipping")).toEqual([]);
    });
  });

  it("answer sanitized and text derived", async () => {
    await withTestTx(handle.db, async (tx) => {
      const dirty = '<p>پاسخ <b>مهم</b></p><script>alert(1)</script><img src="https://evil.example/x.png">';
      const { id, tags } = await upsertFaq(
        tx,
        { groupKey: "shipping", question: " سؤال تستی ", answerHtml: dirty, sort: 2, isActive: true },
        ACTOR,
      );
      expect(id).toBeGreaterThan(0);
      expect(tags).toContain("content");

      const [item] = await getFaqs(tx, "shipping");
      expect(item).toBeDefined();
      if (item === undefined) return;
      expect(item.answerHtml).not.toContain("<script");
      expect(item.answerHtml).not.toContain("alert(1)");
      // rules: «answerHtml → sanitizeHtml (no images)»
      expect(item.answerHtml).not.toContain("<img");
      // The DECIDED whitelist has no <b>; sanitize.ts transforms it to <strong>.
      expect(item.answerHtml).toContain("<strong>مهم</strong>");
      // rules: answerText is plain text for seo/jsonld.faq
      expect(item.answerText).toBe("پاسخ مهم");
      expect(item.answerText).not.toContain("<");
      expect(item.question).toBe("سؤال تستی");
      expect(item.sort).toBe(2);

      // EDGE CASE: the group regex is enforced on the write side
      await expectAppError(
        upsertFaq(
          tx,
          { groupKey: "Shipping", question: "سؤال", answerHtml: "<p>پاسخ</p>", sort: 0, isActive: true },
          ACTOR,
        ),
        "VALIDATION",
        "bad_group_key",
      );

      // an answer that sanitizes down to nothing is not an answer
      await expectAppError(
        upsertFaq(
          tx,
          { groupKey: "shipping", question: "سؤال", answerHtml: "<script>x</script>", sort: 0, isActive: true },
          ACTOR,
        ),
        "VALIDATION",
        "required",
      );
    });
  });

  it("upsert by id updates in place and tags the FAQ page", async () => {
    await withTestTx(handle.db, async (tx) => {
      await tx
        .insert(pages)
        .values({ slug: "faq", title: "پرسش‌های پرتکرار", template: "faq", status: "published" });

      const created = await upsertFaq(
        tx,
        { groupKey: "returns", question: "چطور مرجوع کنم", answerHtml: "<p>الف</p>", sort: 0, isActive: true },
        ACTOR,
      );
      expect(created.tags).toContain("page:faq");

      const updated = await upsertFaq(
        tx,
        {
          id: created.id,
          groupKey: "warranty",
          question: "چطور مرجوع کنم",
          answerHtml: "<p>ب</p>",
          sort: 3,
          isActive: true,
        },
        ACTOR,
      );
      expect(updated.id).toBe(created.id);

      expect(await getFaqs(tx, "returns")).toEqual([]);
      const [moved] = await getFaqs(tx, "warranty");
      expect(moved?.answerText).toBe("ب");
      expect(moved?.sort).toBe(3);
    });
  });

  it("promote requires answer", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId } = await seedMinimal(tx);
      const pending = ulid();
      await tx.insert(questions).values({
        id: pending,
        kind: "question",
        productId,
        phone: "09121234567",
        body: "ابعاد این دستگاه چقدر است",
        status: "pending",
      });

      await expectAppError(promoteQuestion(tx, pending, ACTOR), "VALIDATION", "question_not_answered");
      await expectAppError(promoteQuestion(tx, ulid(), ACTOR), "NOT_FOUND");
      await expectAppError(promoteQuestion(tx, "  ", ACTOR), "VALIDATION", "required");
    });
  });

  it("promote idempotent", async () => {
    await withTestTx(handle.db, async (tx) => {
      const { productId } = await seedMinimal(tx);
      const answered = ulid();
      await tx.insert(questions).values({
        id: answered,
        kind: "question",
        productId,
        phone: "09121234567",
        body: "ابعاد این دستگاه چقدر است",
        answer: 'عرض ۶۰ سانتی‌متر <b>است</b> & کافی',
        status: "answered",
        answeredAt: new Date(),
      });

      const first = await promoteQuestion(tx, answered, ACTOR);
      const second = await promoteQuestion(tx, answered, ACTOR);
      expect(second.id).toBe(first.id);
      expect(first.tags).toContain(`product:${productId}`);

      const group = productFaqGroup(productId);
      const items = await getFaqs(tx, group);
      expect(items).toHaveLength(1);
      // the plain-text answer is escaped, never re-interpreted as markup
      expect(items[0]?.answerHtml).not.toContain("<b>");
      expect(items[0]?.answerText).toBe("عرض ۶۰ سانتی‌متر <b>است</b> & کافی");
      expect(items[0]?.sort).toBe(1);

      const rows = await tx.select({ id: faqsTable.id }).from(faqsTable).where(eq(faqsTable.groupKey, group));
      expect(rows).toHaveLength(1);
    });
  });
});
