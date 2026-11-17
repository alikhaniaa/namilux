import { describe, expect, it } from "vitest";
import { ratingSchema, reviewHelpfulSchema, reviewListQuerySchema, reviewModerateSchema, reviewSchema } from "../reviews";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const valid = {
  rating: 5,
  title: "عالی بود",
  body: "کیفیت ساخت و بسته‌بندی این کتری واقعاً خوب بود و سریع هم رسید.",
};

describe("rating bounds and folding", () => {
  it("folds Persian digits and takes an integer 1..5", () => {
    expect(ratingSchema.parse("۴")).toBe(4);
    for (const r of [1, 2, 3, 4, 5]) expect(ratingSchema.parse(r)).toBe(r);
    for (const bad of [0, 6, 4.5, -1, "۰", "شش", null, undefined, true]) {
      expect(() => ratingSchema.parse(bad), JSON.stringify(bad)).toThrow();
    }
    expect(reviewSchema.parse({ ...valid, rating: "۴" }).rating).toBe(4);
  });
});

describe("text bounds", () => {
  it("title is 3..80 and body is 20..2000 characters after cleaning", () => {
    expect(reviewSchema.parse({ ...valid, title: " خوب " }).title).toBe("خوب");
    expect(() => reviewSchema.parse({ ...valid, title: "خو" })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, title: "x".repeat(81) })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, body: "x".repeat(19) })).toThrow();
    expect(reviewSchema.parse({ ...valid, body: "x".repeat(2000) }).body.length).toBe(2000);
    expect(() => reviewSchema.parse({ ...valid, body: "x".repeat(2001) })).toThrow();
    expect(() => reviewSchema.parse({ rating: 5, title: "خوب" })).toThrow();
    expect(() => reviewSchema.parse({ title: "خوب", body: valid.body })).toThrow();
  });

  it("is strict - the customer never sets the status, the product or the author", () => {
    for (const extra of [
      { status: "approved" },
      { productId: 1044 },
      { customerId: ULID },
      { helpfulCount: 99 },
      { bodyHtml: "<b>x</b>" },
      { createdAt: "2026-08-25T10:00:00.000Z" },
    ]) {
      expect(() => reviewSchema.parse({ ...valid, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });
});

describe("pros/cons limits", () => {
  it("allows at most five non-empty entries each", () => {
    const parsed = reviewSchema.parse({ ...valid, pros: ["سبک", "خوش‌دست"], cons: ["گران"] });
    expect(parsed.pros).toEqual(["سبک", "خوش‌دست"]);
    expect(parsed.cons).toEqual(["گران"]);
    expect(reviewSchema.parse({ ...valid, pros: [] }).pros).toEqual([]);
    expect(() => reviewSchema.parse({ ...valid, pros: Array.from({ length: 6 }, (_, i) => `مزیت ${i}`) })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, pros: [""] })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, cons: ["  "] })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, cons: ["x".repeat(81)] })).toThrow();
    expect(() => reviewSchema.parse({ ...valid, pros: "سبک" })).toThrow();
  });
});

describe("moderation status enum", () => {
  it("takes approved or rejected only", () => {
    expect(reviewModerateSchema.parse({ status: "approved" })).toEqual({ status: "approved" });
    expect(reviewModerateSchema.parse({ status: "rejected", reply: "با تشکر از بازخورد شما" }).reply).toBe(
      "با تشکر از بازخورد شما",
    );
    for (const bad of ["pending", "hidden", "APPROVED", "", null]) {
      expect(() => reviewModerateSchema.parse({ status: bad }), JSON.stringify(bad)).toThrow();
    }
    expect(() => reviewModerateSchema.parse({ status: "approved", reply: "x".repeat(1001) })).toThrow();
    expect(() => reviewModerateSchema.parse({ status: "approved", staffId: ULID })).toThrow();
    expect(() => reviewModerateSchema.parse({})).toThrow();
  });

  it("helpful votes take a ULID and the list query has defaults", () => {
    expect(reviewHelpfulSchema.parse({ reviewId: ULID })).toEqual({ reviewId: ULID });
    expect(() => reviewHelpfulSchema.parse({ reviewId: 1 })).toThrow();
    expect(() => reviewHelpfulSchema.parse({ reviewId: ULID, vote: 1 })).toThrow();

    expect(reviewListQuerySchema.parse({})).toEqual({ page: 1, sort: "newest" });
    expect(reviewListQuerySchema.parse({ page: "۲", sort: "helpful" })).toEqual({ page: 2, sort: "helpful" });
    expect(() => reviewListQuerySchema.parse({ page: 0 })).toThrow();
    expect(() => reviewListQuerySchema.parse({ page: 501 })).toThrow();
    expect(() => reviewListQuerySchema.parse({ sort: "oldest" })).toThrow();
    expect(() => reviewListQuerySchema.parse({ pageSize: 50 })).toThrow();
  });
});
