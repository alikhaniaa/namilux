import { AppError, ERROR_FA, profileSchema, updateProfile } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const PUT = handler({
  schema: profileSchema,
  bodyCap: 4 * 1024,
  auth: "session",
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ input, user, ip }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const c = await updateProfile(db, user.customerId, input, { type: "customer", id: user.customerId, ip });
    return {
      customer: {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        birthday: c.birthday,
        gender: c.gender,
        marketingOptIn: c.marketingOptIn,
      },
    };
  },
});
