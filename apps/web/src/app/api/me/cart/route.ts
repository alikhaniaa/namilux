import { AppError, ERROR_FA, cart, cartSyncSchema } from "@namilux/core";
import { CHANNEL } from "@/lib/channel";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    return cart.get(db, user.customerId, CHANNEL);
  },
});

export const PUT = handler({
  schema: cartSyncSchema,
  bodyCap: 8 * 1024,
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, req }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const merge = new URL(req.url).searchParams.get("merge") === "true";
    const lines = input.lines.map((l) => ({ id: l.productId, qty: l.qty, addedAt: input.updatedAt }));
    if (merge) {
      const merged = await cart.merge(db, user.customerId, lines, CHANNEL);
      return { lines: merged, updatedAt: new Date().toISOString() };
    }
    return cart.replace(db, user.customerId, lines, input.updatedAt, CHANNEL);
  },
});
