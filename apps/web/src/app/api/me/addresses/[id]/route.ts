import { z } from "zod";
import { AppError, ERROR_FA, addressSchema, addresses } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

const putSchema = z.union([addressSchema, z.object({ isDefault: z.literal(true) }).strict()]);

export const PUT = handler({
  schema: putSchema,
  bodyCap: 4 * 1024,
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const id = params.id ?? "";
    if ("province" in input) {
      return { address: await addresses.update(db, user.customerId, id, input) };
    }
    await addresses.setDefault(db, user.customerId, id);
    const address = await addresses.get(db, user.customerId, id);
    if (address === null) throw new AppError("NOT_FOUND", 404, "نشانی پیدا نشد");
    return { address };
  },
});

export const DELETE = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user, params }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    await addresses.remove(db, user.customerId, params.id ?? "");
    return { ok: true };
  },
});
