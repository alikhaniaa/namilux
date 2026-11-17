import { AppError, ERROR_FA, addressSchema, addresses } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    return { addresses: await addresses.list(db, user.customerId) };
  },
});

export const POST = handler({
  schema: addressSchema,
  bodyCap: 4 * 1024,
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    return { address: await addresses.create(db, user.customerId, input) };
  },
});
