import { AppError, ERROR_FA, reviewHelpfulSchema, reviewListQuerySchema, reviewSchema, reviews } from "@namilux/core";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

function productIdOf(params: Record<string, string>): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
  return id;
}

export const GET = handler({
  auth: "none",
  bodyCap: 0,
  limit: [{ name: "reviews.ip", key: ({ ip }) => ip }],
  run: async ({ req, params }) => {
    const sp = new URL(req.url).searchParams;
    const page = sp.get("page");
    const sort = sp.get("sort");
    const q = reviewListQuerySchema.safeParse({
      ...(page === null ? {} : { page: Number(page) }),
      ...(sort === null ? {} : { sort }),
    });
    if (!q.success) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return reviews.listForProduct(db, productIdOf(params), q.data);
  },
});

// Two strict bodies share the POST: a review, or a helpful vote (`?vote=1`).
const postSchema = z.union([reviewSchema, reviewHelpfulSchema]);

export const POST = handler({
  auth: "session",
  schema: postSchema,
  bodyCap: 8 * 1024,
  limit: [{ name: "reviews.customer", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, req, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const productId = productIdOf(params);
    const voting = new URL(req.url).searchParams.get("vote") === "1";
    if ("reviewId" in input) {
      if (!voting) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
      return reviews.vote(db, input.reviewId, user.customerId);
    }
    if (voting) throw new AppError("VALIDATION", 400, ERROR_FA.VALIDATION);
    return reviews.submit(db, user.customerId, { ...input, productId });
  },
});
