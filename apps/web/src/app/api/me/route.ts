import { AppError, ERROR_FA, getCustomer, publicView, wishlist } from "@namilux/core";
import { db } from "@/lib/db";
import { handler } from "@/lib/http-handler";

export const GET = handler({
  auth: "session",
  bodyCap: 0,
  limit: [{ name: "me", key: ({ user, ip }) => user?.customerId ?? ip }],
  run: async ({ user }) => {
    if (user === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const customer = await getCustomer(db, user.customerId);
    if (customer === null) throw new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED);
    const ids = await wishlist.get(db, user.customerId);
    return {
      user: publicView(customer),
      counts: { orders: customer.ordersCount, wishlist: ids.length, points: customer.pointsBalance },
    };
  },
});
