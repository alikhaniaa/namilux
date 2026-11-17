import { AppError, ERROR_FA, wishlist, wishlistSyncSchema } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    return { ids: await wishlist.get(db, user.customerId) };
  },
});

export const PUT = handler({
  schema: wishlistSyncSchema,
  bodyCap: 8 * 1024,
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, req }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const merge = new URL(req.url).searchParams.get("merge") === "true";
    let ids = input.ids;
    if (merge) {
      const server = await wishlist.get(db, user.customerId);
      ids = [...new Set([...input.ids, ...server])];
    }
    return { ids: await wishlist.replace(db, user.customerId, ids) };
  },
});
